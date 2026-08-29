import { runQuery, type QueryParameter } from "./bigquery.js";
import { BQ_DATASET, BQ_INSERT_CHUNK_SIZE, BQ_TABLE } from "./constants.js";
import { fetchDailyInsights } from "./metaClient.js";
import type { BigQueryEnv, InsightsRow, RawInsightRow } from "./types.js";

function toNumber(value: string | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function findAction(actions: RawInsightRow["actions"], needle: string): number | null {
  if (!actions?.length) return null;
  const match = actions.find((a) => a.action_type.includes(needle));
  return match ? toNumber(match.value) : null;
}

function toInsightsRow(raw: RawInsightRow, accountId: string): InsightsRow {
  return {
    date: raw.date_start,
    account_id: accountId,
    campaign_id: raw.campaign_id ?? null,
    campaign_name: raw.campaign_name ?? null,
    adset_id: raw.adset_id ?? null,
    adset_name: raw.adset_name ?? null,
    ad_id: raw.ad_id ?? null,
    ad_name: raw.ad_name ?? null,
    spend: toNumber(raw.spend),
    impressions: toNumber(raw.impressions),
    clicks: toNumber(raw.clicks),
    ctr: toNumber(raw.ctr),
    cpc: toNumber(raw.cpc),
    cpm: toNumber(raw.cpm),
    reach: toNumber(raw.reach),
    frequency: toNumber(raw.frequency),
    purchase_roas: raw.purchase_roas?.length ? toNumber(raw.purchase_roas[0].value) : null,
    purchases: findAction(raw.actions, "purchase"),
    leads: findAction(raw.actions, "lead"),
    link_clicks: findAction(raw.actions, "link_click"),
    actions_json: raw.actions?.length ? JSON.stringify(raw.actions) : null,
  };
}

// Order/types must match sql/schema.sql (minus synced_at, which the table
// fills in via its own DEFAULT).
const STRUCT_FIELDS: Array<{ name: keyof InsightsRow; type: string }> = [
  { name: "date", type: "DATE" },
  { name: "account_id", type: "STRING" },
  { name: "campaign_id", type: "STRING" },
  { name: "campaign_name", type: "STRING" },
  { name: "adset_id", type: "STRING" },
  { name: "adset_name", type: "STRING" },
  { name: "ad_id", type: "STRING" },
  { name: "ad_name", type: "STRING" },
  { name: "spend", type: "FLOAT64" },
  { name: "impressions", type: "INT64" },
  { name: "clicks", type: "INT64" },
  { name: "ctr", type: "FLOAT64" },
  { name: "cpc", type: "FLOAT64" },
  { name: "cpm", type: "FLOAT64" },
  { name: "reach", type: "INT64" },
  { name: "frequency", type: "FLOAT64" },
  { name: "purchase_roas", type: "FLOAT64" },
  { name: "purchases", type: "INT64" },
  { name: "leads", type: "INT64" },
  { name: "link_clicks", type: "INT64" },
  { name: "actions_json", type: "STRING" },
];

function rowsToQueryParameter(rows: InsightsRow[]): QueryParameter {
  return {
    name: "rows",
    parameterType: {
      type: "ARRAY",
      arrayType: {
        type: "STRUCT",
        structTypes: STRUCT_FIELDS.map((f) => ({ name: f.name, type: { type: f.type } })),
      },
    },
    parameterValue: {
      arrayValues: rows.map((row) => ({
        structValues: Object.fromEntries(
          STRUCT_FIELDS.map((f) => {
            const value = row[f.name];
            return [f.name, value === null || value === undefined ? {} : { value: String(value) }];
          })
        ),
      })),
    },
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Syncs one ad account's Meta Ads insights for [since, until] (inclusive,
 * YYYY-MM-DD) into BigQuery. Deletes any existing rows for that
 * account+date range first, so re-running the same window — the daily cron
 * firing twice, or re-running a backfill chunk — never duplicates rows, and
 * never touches other accounts' rows on the same dates.
 */
export async function syncRange(
  env: BigQueryEnv,
  accountId: string,
  since: string,
  until: string,
  opts: { dryRun?: boolean } = {}
): Promise<{ rows: number }> {
  const rawRows = await fetchDailyInsights(accountId, since, until);
  const rows = rawRows.map((raw) => toInsightsRow(raw, accountId));

  if (opts.dryRun) return { rows: rows.length };

  const table = `\`${env.GCP_PROJECT_ID}.${BQ_DATASET}.${BQ_TABLE}\``;

  await runQuery(env, `DELETE FROM ${table} WHERE account_id = @account_id AND date BETWEEN @since AND @until`, [
    { name: "account_id", parameterType: { type: "STRING" }, parameterValue: { value: accountId } },
    { name: "since", parameterType: { type: "DATE" }, parameterValue: { value: since } },
    { name: "until", parameterType: { type: "DATE" }, parameterValue: { value: until } },
  ]);

  const columns = STRUCT_FIELDS.map((f) => f.name).join(", ");
  for (const batch of chunk(rows, BQ_INSERT_CHUNK_SIZE)) {
    await runQuery(env, `INSERT INTO ${table} (${columns}) SELECT ${columns} FROM UNNEST(@rows)`, [
      rowsToQueryParameter(batch),
    ]);
  }

  return { rows: rows.length };
}
