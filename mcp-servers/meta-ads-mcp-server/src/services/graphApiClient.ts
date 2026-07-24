import {
  GRAPH_API_BASE_URL,
  MAX_PAGE_LIMIT,
  RATE_LIMIT_BASE_DELAY_MS,
  RATE_LIMIT_MAX_RETRIES,
  USAGE_BACKOFF_THRESHOLD_PCT,
} from "../constants.js";
import { GraphApiError, isRateLimitError } from "./errorHandler.js";
import type { GraphApiErrorPayload, GraphApiListResponse, PagedResult } from "../types.js";

const REQUEST_TIMEOUT_MS = 60000;

/**
 * Reads credentials from process.env. Shared by both entry points — the
 * Node (stdio) entry point inherits process.env directly, and the
 * Cloudflare Worker entry point (src/worker.ts) copies its env bindings
 * into process.env at the top of each request before any tool runs.
 */
export function getAccessToken(): string {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "META_ACCESS_TOKEN environment variable is not set. Generate a System User token in " +
        "Business Settings and set it before starting the server."
    );
  }
  return token;
}

/** Returns the ad account ID with the required "act_" prefix. */
export function getAdAccountId(): string {
  const id = process.env.META_AD_ACCOUNT_ID;
  if (!id) {
    throw new Error("META_AD_ACCOUNT_ID environment variable is not set.");
  }
  return id.startsWith("act_") ? id : `act_${id}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Meta reports quota consumption via response headers (JSON values whose
 * shape varies by header) rather than a single rate-limit-remaining number.
 * We just look for the highest percentage figure and warn on stderr so the
 * operator can see it coming before a hard 429.
 */
function warnIfNearingUsageLimit(headers: Headers): void {
  const usageHeaderNames = ["x-business-use-case-usage", "x-ad-account-usage", "x-app-usage"];
  for (const name of usageHeaderNames) {
    const raw = headers.get(name);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const values: number[] = [];
      const collect = (node: unknown): void => {
        if (Array.isArray(node)) {
          for (const item of node) collect(item);
        } else if (node && typeof node === "object") {
          for (const v of Object.values(node as Record<string, unknown>)) {
            if (typeof v === "number") values.push(v);
            else collect(v);
          }
        }
      };
      collect(parsed);
      const max = values.length ? Math.max(...values) : 0;
      if (max >= USAGE_BACKOFF_THRESHOLD_PCT) {
        console.error(`meta-ads-mcp-server: API usage at ${max}% (${name}) — space out requests.`);
      }
    } catch {
      // Header value wasn't JSON; nothing to parse.
    }
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  params?: Record<string, unknown>;
}

function buildUrl(endpoint: string, params: Record<string, unknown>): URL {
  const url = new URL(`${GRAPH_API_BASE_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

/**
 * Core request function used by every tool. Injects auth via the
 * Authorization header (not the access_token query param, so the token
 * never ends up in request-URL logs), and retries on throttling with
 * exponential backoff before giving up and letting the caller see the
 * Graph API error. Uses the standard Fetch API so it runs unmodified on
 * both Node 18+ and the Cloudflare Workers runtime.
 */
export async function graphRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", params = {} } = options;
  let attempt = 0;

  // GET requests carry params in the query string. POST/DELETE send them as
  // a form-encoded body instead — several payloads here (targeting,
  // object_story_spec, special_ad_categories) are JSON blobs that could
  // otherwise push the URL past practical length limits.
  const isBodyMethod = method === "POST" || method === "DELETE";
  const url = isBodyMethod ? buildUrl(endpoint, {}) : buildUrl(endpoint, params);
  const requestBody = isBodyMethod
    ? new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])))
    : undefined;

  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${getAccessToken()}`,
          ...(requestBody ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        ...(requestBody ? { body: requestBody.toString() } : {}),
      });

      warnIfNearingUsageLimit(response.headers);

      if (!response.ok) {
        let payload: GraphApiErrorPayload | undefined;
        try {
          const body = (await response.json()) as { error?: GraphApiErrorPayload };
          payload = body?.error;
        } catch {
          // Response body wasn't JSON; surface the bare status instead.
        }
        throw new GraphApiError(response.status, payload);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (isRateLimitError(error) && attempt < RATE_LIMIT_MAX_RETRIES) {
        const delay = RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt;
        console.error(
          `meta-ads-mcp-server: rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES})`
        );
        await sleep(delay);
        attempt += 1;
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Follows Graph API's cursor-based pagination (`paging.cursors.after`) up to
 * `limit` items, never loading more pages than requested into memory.
 */
export async function listPaged<T>(
  endpoint: string,
  params: Record<string, unknown>,
  limit: number
): Promise<PagedResult<T>> {
  const capped = Math.max(1, Math.min(limit, MAX_PAGE_LIMIT));
  const items: T[] = [];
  let after: string | undefined = params.after as string | undefined;
  let lastPageHadNext = false;

  while (items.length < capped) {
    const pageSize = Math.min(capped - items.length, MAX_PAGE_LIMIT);
    const response = await graphRequest<GraphApiListResponse<T>>(endpoint, {
      params: { ...params, after, limit: pageSize },
    });
    items.push(...response.data);
    after = response.paging?.cursors?.after;
    lastPageHadNext = Boolean(response.paging?.next && after);
    if (response.data.length === 0 || !lastPageHadNext) break;
  }

  return {
    count: items.length,
    items: items.slice(0, capped),
    has_more: lastPageHadNext,
    ...(lastPageHadNext ? { next_cursor: after } : {}),
  };
}
