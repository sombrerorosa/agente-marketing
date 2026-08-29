/**
 * Cloudflare Workers entry point. A Cron Trigger runs `scheduled()` daily to
 * sync "yesterday" (UTC); `fetch()` exposes a manual /sync endpoint for
 * smoke-testing or resyncing a single day/range on demand.
 */

import { syncRange } from "./sync.js";

interface Env {
  META_ACCESS_TOKEN: string;
  META_AD_ACCOUNT_ID: string;
  GRAPH_API_VERSION?: string;
  GCP_PROJECT_ID: string;
  GCP_CLIENT_EMAIL: string;
  GCP_PRIVATE_KEY: string;
  BQ_DATASET?: string;
  BQ_TABLE?: string;
  SYNC_SHARED_SECRET?: string;
}

const REQUIRED_KEYS: Array<keyof Env> = ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID", "GCP_PROJECT_ID", "GCP_CLIENT_EMAIL", "GCP_PRIVATE_KEY"];

function missingEnvKeys(env: Env): string[] {
  return REQUIRED_KEYS.filter((key) => !env[key]);
}

// The shared tool logic reads credentials from process.env for parity with
// the local backfill script — bridge the Worker's env bindings into it
// explicitly rather than relying on nodejs_compat auto-population.
function bridgeEnv(env: Env): void {
  process.env.META_ACCESS_TOKEN = env.META_ACCESS_TOKEN;
  process.env.META_AD_ACCOUNT_ID = env.META_AD_ACCOUNT_ID;
  if (env.GRAPH_API_VERSION) process.env.GRAPH_API_VERSION = env.GRAPH_API_VERSION;
  if (env.BQ_DATASET) process.env.BQ_DATASET = env.BQ_DATASET;
  if (env.BQ_TABLE) process.env.BQ_TABLE = env.BQ_TABLE;
}

function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const missing = missingEnvKeys(env);
    if (missing.length) {
      console.error(`meta-ads-bigquery-sync: missing env vars, skipping run: ${missing.join(", ")}`);
      return;
    }

    bridgeEnv(env);
    const date = yesterday();
    ctx.waitUntil(
      syncRange(env, date, date)
        .then(({ rows }) => console.log(`meta-ads-bigquery-sync: synced ${rows} rows for ${date}`))
        .catch((error) => console.error(`meta-ads-bigquery-sync: sync failed for ${date}`, error))
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

    bridgeEnv(env);
    try {
      const { rows } = await syncRange(env, date, until);
      return new Response(`Synced ${rows} rows for ${date}..${until}`, { status: 200 });
    } catch (error) {
      return new Response(`Sync failed: ${error instanceof Error ? error.message : String(error)}`, { status: 500 });
    }
  },
};
