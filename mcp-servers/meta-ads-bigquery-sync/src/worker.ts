/**
 * Cloudflare Workers entry point. A Cron Trigger runs `scheduled()` daily to
 * re-sync a rolling trailing window (not just "yesterday") — since the sync
 * is an idempotent DELETE+INSERT per date range, this makes a single failed
 * run (expired token, Meta/BigQuery outage) self-heal on the next day's run
 * instead of silently leaving that day's data missing forever. `fetch()`
 * exposes a manual /sync endpoint for smoke-testing or resyncing any
 * specific day/range on demand.
 */

import { getAdAccountIds } from "./metaClient.js";
import { syncRange } from "./sync.js";

interface Env {
  META_ACCESS_TOKEN: string;
  META_AD_ACCOUNT_IDS?: string;
  META_AD_ACCOUNT_ID?: string;
  GRAPH_API_VERSION?: string;
  GCP_PROJECT_ID: string;
  GCP_CLIENT_EMAIL: string;
  GCP_PRIVATE_KEY: string;
  BQ_DATASET?: string;
  BQ_TABLE?: string;
  SYNC_SHARED_SECRET?: string;
}

const REQUIRED_KEYS: Array<keyof Env> = ["META_ACCESS_TOKEN", "GCP_PROJECT_ID", "GCP_CLIENT_EMAIL", "GCP_PRIVATE_KEY"];

function missingEnvKeys(env: Env): string[] {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  if (!env.META_AD_ACCOUNT_IDS && !env.META_AD_ACCOUNT_ID) missing.push("META_AD_ACCOUNT_IDS");
  return missing;
}

// The shared tool logic reads credentials from process.env for parity with
// the local backfill script — bridge the Worker's env bindings into it
// explicitly rather than relying on nodejs_compat auto-population.
function bridgeEnv(env: Env): void {
  process.env.META_ACCESS_TOKEN = env.META_ACCESS_TOKEN;
  if (env.META_AD_ACCOUNT_IDS) process.env.META_AD_ACCOUNT_IDS = env.META_AD_ACCOUNT_IDS;
  if (env.META_AD_ACCOUNT_ID) process.env.META_AD_ACCOUNT_ID = env.META_AD_ACCOUNT_ID;
  if (env.GRAPH_API_VERSION) process.env.GRAPH_API_VERSION = env.GRAPH_API_VERSION;
  if (env.BQ_DATASET) process.env.BQ_DATASET = env.BQ_DATASET;
  if (env.BQ_TABLE) process.env.BQ_TABLE = env.BQ_TABLE;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function yesterday(): string {
  return daysAgo(1);
}

// How many trailing days the daily cron re-syncs each run. Cheap to widen
// (one extra Meta call + a few extra BigQuery rows per account) and it's
// what lets a single failed run recover on its own the next day.
const ROLLING_WINDOW_DAYS = 3;

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const missing = missingEnvKeys(env);
    if (missing.length) {
      console.error(`meta-ads-bigquery-sync: missing env vars, skipping run: ${missing.join(", ")}`);
      return;
    }

    bridgeEnv(env);
    const since = daysAgo(ROLLING_WINDOW_DAYS);
    const until = yesterday();
    const accountIds = getAdAccountIds();
    ctx.waitUntil(
      Promise.all(
        accountIds.map((accountId) =>
          syncRange(env, accountId, since, until)
            .then(({ rows }) => console.log(`meta-ads-bigquery-sync: synced ${rows} rows for ${accountId} (${since}..${until})`))
            .catch((error) => console.error(`meta-ads-bigquery-sync: sync failed for ${accountId} (${since}..${until})`, error))
        )
      ).then(() => undefined)
    );
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/sync") {
      return new Response("meta-ads-bigquery-sync: POST /sync?date=YYYY-MM-DD (optionally &until=YYYY-MM-DD) to trigger a manual run.", {
        status: 200,
      });
    }

    if (env.SYNC_SHARED_SECRET && request.headers.get("x-sync-secret") !== env.SYNC_SHARED_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const missing = missingEnvKeys(env);
    if (missing.length) {
      return new Response(`Missing env vars: ${missing.join(", ")}`, { status: 500 });
    }

    const date = url.searchParams.get("date") ?? yesterday();
    const until = url.searchParams.get("until") ?? date;
    const onlyAccount = url.searchParams.get("account");

    bridgeEnv(env);
    try {
      const accountIds = onlyAccount ? [onlyAccount.startsWith("act_") ? onlyAccount : `act_${onlyAccount}`] : getAdAccountIds();
      const results = await Promise.all(accountIds.map((accountId) => syncRange(env, accountId, date, until)));
      const summary = accountIds.map((accountId, i) => `${accountId}: ${results[i].rows} rows`).join(", ");
      return new Response(`Synced ${date}..${until} — ${summary}`, { status: 200 });
    } catch (error) {
      return new Response(`Sync failed: ${error instanceof Error ? error.message : String(error)}`, { status: 500 });
    }
  },
};
