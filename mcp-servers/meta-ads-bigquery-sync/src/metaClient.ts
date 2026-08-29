import {
  GRAPH_API_BASE_URL,
  INSIGHT_FIELDS,
  META_PAGE_LIMIT,
  RATE_LIMIT_BASE_DELAY_MS,
  RATE_LIMIT_MAX_RETRIES,
} from "./constants.js";
import type { GraphApiErrorPayload, GraphApiListResponse, RawInsightRow } from "./types.js";

// Meta error codes that indicate throttling rather than a real client error.
// See https://developers.facebook.com/docs/graph-api/guides/error-handling
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

export class GraphApiError extends Error {
  readonly status: number;
  readonly payload?: GraphApiErrorPayload;

  constructor(status: number, payload?: GraphApiErrorPayload) {
    super(payload?.message || `Graph API request failed with HTTP status ${status}`);
    this.name = "GraphApiError";
    this.status = status;
    this.payload = payload;
  }
}

function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof GraphApiError)) return false;
  if (!error.payload) return error.status === 429;
  return RATE_LIMIT_CODES.has(error.payload.code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAccessToken(): string {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN is not set.");
  return token;
}

function getAdAccountId(): string {
  const id = process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error("META_AD_ACCOUNT_ID is not set.");
  return id.startsWith("act_") ? id : `act_${id}`;
}

async function graphRequest<T>(endpoint: string, params: Record<string, unknown>): Promise<T> {
  const url = new URL(`${GRAPH_API_BASE_URL}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }

  let attempt = 0;
  while (true) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    });

    if (response.ok) {
      return (await response.json()) as T;
    }

    let payload: GraphApiErrorPayload | undefined;
    try {
      const body = (await response.json()) as { error?: GraphApiErrorPayload };
      payload = body?.error;
    } catch {
      // Response body wasn't JSON; surface the bare status instead.
    }
    const error = new GraphApiError(response.status, payload);

    if (isRateLimitError(error) && attempt < RATE_LIMIT_MAX_RETRIES) {
      const delay = RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt;
      console.error(`meta-ads-bigquery-sync: rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES})`);
      await sleep(delay);
      attempt += 1;
      continue;
    }
    throw error;
  }
}

/**
 * Fetches ad-level insights broken out per day (time_increment=1) for
 * [since, until]. Ad-level is Meta's finest granularity — campaign/adset
 * names ride along on each ad row, so campaign/adset totals are rollups in
 * BigQuery rather than separate stored rows (avoids double-counting spend).
 */
export async function fetchDailyInsights(since: string, until: string): Promise<RawInsightRow[]> {
  const rows: RawInsightRow[] = [];
  let after: string | undefined;

  while (true) {
    const response = await graphRequest<GraphApiListResponse<RawInsightRow>>(`/${getAdAccountId()}/insights`, {
      level: "ad",
      time_increment: 1,
      time_range: JSON.stringify({ since, until }),
      fields: INSIGHT_FIELDS.join(","),
      limit: META_PAGE_LIMIT,
      after,
    });
    rows.push(...response.data);
    after = response.paging?.cursors?.after;
    if (!response.paging?.next || !after) break;
  }

  return rows;
}
