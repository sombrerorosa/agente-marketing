/**
 * One-off historical backfill: loads Meta Ads insights month-by-month into
 * BigQuery so the report has history from day one, not just from today
 * forward (the deployed Worker's cron only ever syncs "yesterday").
 *
 * Usage (from mcp-servers/meta-ads-bigquery-sync/):
 *   set -a; source .env; set +a
 *   npm run backfill -- --since 2023-01-01 --until 2026-08-28
 *   npm run backfill -- --since 2023-01-01 --dry-run   # Meta only, no BigQuery writes
 */
import { getAdAccountIds } from "../src/metaClient.js";
import { syncRange } from "../src/sync.js";
import type { BigQueryEnv } from "../src/types.js";

interface Args {
  since: string;
  until: string;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const until = get("--until") ?? new Date().toISOString().slice(0, 10);
  const defaultSince = new Date();
  // Meta's own ad-insights lookback ceiling is ~37 months; 36 stays safely inside it.
  defaultSince.setUTCMonth(defaultSince.getUTCMonth() - 36);
  const since = get("--since") ?? defaultSince.toISOString().slice(0, 10);
  const dryRun = args.includes("--dry-run");

  return { since, until, dryRun };
}

/** Splits [since, until] into calendar-month windows, each synced as one DELETE+INSERT. */
function monthChunks(since: string, until: string): Array<[string, string]> {
  const chunks: Array<[string, string]> = [];
  let start = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);

  while (start <= end) {
    const monthEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const boundedEnd = monthEnd > end ? end : monthEnd;
    chunks.push([start.toISOString().slice(0, 10), boundedEnd.toISOString().slice(0, 10)]);
    start = new Date(Date.UTC(boundedEnd.getUTCFullYear(), boundedEnd.getUTCMonth(), boundedEnd.getUTCDate() + 1));
  }

  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const { since, until, dryRun } = parseArgs();

  const requiredAlways = ["META_ACCESS_TOKEN"];
  const requiredForWrite = ["GCP_PROJECT_ID", "GCP_CLIENT_EMAIL", "GCP_PRIVATE_KEY"];
  const required = dryRun ? requiredAlways : [...requiredAlways, ...requiredForWrite];
  const missing = required.filter((key) => !process.env[key]);
  if (!process.env.META_AD_ACCOUNT_IDS && !process.env.META_AD_ACCOUNT_ID) missing.push("META_AD_ACCOUNT_IDS");
  if (missing.length) {
    console.error(`Missing required env var(s): ${missing.join(", ")}. Copy .env.example to .env, fill it in, then 'set -a; source .env; set +a' before running this script.`);
    process.exit(1);
  }

  const accountIds = getAdAccountIds();
  const chunks = monthChunks(since, until);
  console.log(
    `Backfilling ${accountIds.length} account(s) x ${chunks.length} month(s) from ${since} to ${until}${dryRun ? " (dry run — Meta only, no BigQuery writes)" : ""}`
  );

  const env: BigQueryEnv = {
    GCP_PROJECT_ID: process.env.GCP_PROJECT_ID ?? "",
    GCP_CLIENT_EMAIL: process.env.GCP_CLIENT_EMAIL ?? "",
    GCP_PRIVATE_KEY: process.env.GCP_PRIVATE_KEY ?? "",
  };

  let totalRows = 0;
  for (const accountId of accountIds) {
    for (const [chunkSince, chunkUntil] of chunks) {
      try {
        const { rows } = await syncRange(env, accountId, chunkSince, chunkUntil, { dryRun });
        totalRows += rows;
        console.log(`${dryRun ? "[dry run] would sync" : "Synced"} ${rows} rows for ${accountId} ${chunkSince}..${chunkUntil}`);
      } catch (error) {
        console.error(`Failed on ${accountId} ${chunkSince}..${chunkUntil}:`, error);
        process.exit(1);
      }
      // Be gentle with Meta's rate limits across many sequential month windows.
      await sleep(1500);
    }
  }

  console.log(`Backfill complete. Total rows: ${totalRows}.`);
}

main();
