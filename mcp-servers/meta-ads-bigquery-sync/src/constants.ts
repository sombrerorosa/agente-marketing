export const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v21.0";
export const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export const INSIGHT_FIELDS = [
  "date_start",
  "date_stop",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "reach",
  "frequency",
  "actions",
  "purchase_roas",
];

// Meta's insights endpoint accepts up to 500 rows per page.
export const META_PAGE_LIMIT = 500;
export const RATE_LIMIT_MAX_RETRIES = 3;
export const RATE_LIMIT_BASE_DELAY_MS = 2000;

export const BQ_DATASET = process.env.BQ_DATASET || "meta_ads";
export const BQ_TABLE = process.env.BQ_TABLE || "insights_daily";

// Rows per INSERT ... SELECT FROM UNNEST(@rows) call — keeps each query
// request body and BigQuery's per-request parameter size well under limits.
export const BQ_INSERT_CHUNK_SIZE = 500;
