import {
  GOOGLE_ADS_BASE_URL,
  MAX_PAGE_LIMIT,
  OAUTH_TOKEN_URL,
  RATE_LIMIT_BASE_DELAY_MS,
  RATE_LIMIT_MAX_RETRIES,
  TOKEN_REFRESH_SAFETY_MARGIN_MS,
} from "../constants.js";
import { GoogleAdsApiError, isRateLimitError } from "./errorHandler.js";
import type { GaqlRow, GaqlSearchResponse, GoogleApiErrorPayload, MutateResponse, MutateResult, PagedResult } from "../types.js";

const REQUEST_TIMEOUT_MS = 60000;

/**
 * Reads credentials from process.env. Shared by both entry points — the
 * Node (stdio) entry point inherits process.env directly, and the
 * Cloudflare Worker entry point (src/worker.ts) copies its env bindings
 * into process.env at the top of each request before any tool runs.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set. See README.md for setup.`);
  }
  return value;
}

function digitsOnly(id: string): string {
  return id.replace(/[^0-9]/g, "");
}

export function getCustomerId(): string {
  return digitsOnly(requireEnv("GOOGLE_ADS_CUSTOMER_ID"));
}

/** Optional — only set when authenticating against a client account via its MCC. */
export function getLoginCustomerId(): string | undefined {
  const raw = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  return raw ? digitsOnly(raw) : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cached per isolate/process, like the McpServer instance in worker.ts —
// an OAuth access token is valid for roughly an hour, so there's no reason
// to trade it in on every tool call.
let cachedToken: { accessToken: string; expiresAt: number } | undefined;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_ADS_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_ADS_CLIENT_SECRET"),
      refresh_token: requireEnv("GOOGLE_ADS_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    let payload: { error?: string; error_description?: string } = {};
    try {
      payload = (await response.json()) as { error?: string; error_description?: string };
    } catch {
      // Response body wasn't JSON; fall through to the generic message below.
    }
    throw new GoogleAdsApiError(response.status, {
      code: response.status,
      status: "UNAUTHENTICATED",
      message:
        payload.error_description ||
        payload.error ||
        "Failed to exchange refresh token for an access token. It may have been revoked — regenerate GOOGLE_ADS_REFRESH_TOKEN.",
    });
  }

  const body = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000 - TOKEN_REFRESH_SAFETY_MARGIN_MS,
  };
  return cachedToken.accessToken;
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await getAccessToken()}`,
    "Content-Type": "application/json",
  };
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (developerToken) headers["developer-token"] = developerToken;
  const loginCustomerId = getLoginCustomerId();
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;
  return headers;
}

/**
 * POSTs a JSON body to a Google Ads REST endpoint (search or mutate) and
 * retries on throttling with exponential backoff before giving up and
 * letting the caller see the Google Ads error. Uses the standard Fetch API
 * so it runs unmodified on both Node 18+ and the Cloudflare Workers runtime.
 */
async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${GOOGLE_ADS_BASE_URL}${path}`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        let payload: GoogleApiErrorPayload | undefined;
        try {
          const parsed = (await response.json()) as { error?: GoogleApiErrorPayload };
          payload = parsed?.error;
        } catch {
          // Response body wasn't JSON; surface the bare status instead.
        }
        throw new GoogleAdsApiError(response.status, payload);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (isRateLimitError(error) && attempt < RATE_LIMIT_MAX_RETRIES) {
        const delay = RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt;
        console.error(
          `google-ads-mcp-server: rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES})`
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

/** Runs one page of a GAQL query against googleAds:search. */
async function search(query: string, pageToken: string | undefined, pageSize: number): Promise<GaqlSearchResponse> {
  return post<GaqlSearchResponse>(`/customers/${getCustomerId()}/googleAds:search`, {
    query,
    pageSize,
    ...(pageToken ? { pageToken } : {}),
  });
}

/**
 * Runs a GAQL query, following Google's opaque-token pagination up to
 * `limit` rows, never loading more pages than requested into memory.
 */
export async function searchPaged(query: string, limit: number, startToken?: string): Promise<PagedResult<GaqlRow>> {
  const capped = Math.max(1, Math.min(limit, MAX_PAGE_LIMIT));
  const items: GaqlRow[] = [];
  let pageToken = startToken;
  let nextPageToken: string | undefined;

  while (items.length < capped) {
    const pageSize = Math.min(capped - items.length, MAX_PAGE_LIMIT);
    const response = await search(query, pageToken, pageSize);
    const rows = response.results ?? [];
    items.push(...rows);
    nextPageToken = response.nextPageToken;
    if (rows.length === 0 || !nextPageToken) break;
    pageToken = nextPageToken;
  }

  return {
    count: items.length,
    items: items.slice(0, capped),
    has_more: Boolean(nextPageToken),
    ...(nextPageToken ? { next_cursor: nextPageToken } : {}),
  };
}

/** Runs a GAQL query and returns at most one row — for get_* tools keyed by resource id. */
export async function searchOne(query: string): Promise<GaqlRow | undefined> {
  const response = await search(query, undefined, 1);
  return response.results?.[0];
}

/** Builds a resource name, e.g. resourceName("campaigns", "456") -> "customers/123/campaigns/456". */
export function resourceName(collection: string, id: string): string {
  return `customers/${getCustomerId()}/${collection}/${id}`;
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Builds the {update, updateMask} shape every `update` mutate operation
 * needs — Google requires an explicit FieldMask (snake_case paths) listing
 * exactly which fields changed, separate from the camelCase JSON body.
 */
export function buildUpdateOperation(resource: string, fields: Record<string, unknown>): MutateOperation {
  return {
    update: { resourceName: resource, ...fields },
    updateMask: Object.keys(fields).map(camelToSnake).join(","),
  };
}

export type MutateOperation = Record<string, unknown>;

/**
 * Sends one or more create/update/remove operations to a `:mutate` service
 * (campaigns, campaignBudgets, adGroups, adGroupAds, adGroupCriteria,
 * campaignCriteria, userLists, ...) in a single request. partialFailure is
 * always off — if any operation fails, the whole call fails, so a tool
 * never has to reconcile a mix of applied and rejected operations.
 */
export async function mutate(resource: string, operations: MutateOperation[]): Promise<MutateResult[]> {
  const response = await post<MutateResponse>(`/customers/${getCustomerId()}/${resource}:mutate`, {
    operations,
    partialFailure: false,
  });
  return response.results ?? [];
}

/**
 * Lists the customer IDs the configured OAuth user/refresh token can
 * access — the one GET-shaped call in the API (no customer ID in the path,
 * since you don't know it yet). Useful during setup, before
 * GOOGLE_ADS_CUSTOMER_ID is known.
 */
export async function listAccessibleCustomers(): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${GOOGLE_ADS_BASE_URL}/customers:listAccessibleCustomers`, {
      method: "GET",
      headers: await authHeaders(),
      signal: controller.signal,
    });
    if (!response.ok) {
      let payload: GoogleApiErrorPayload | undefined;
      try {
        const parsed = (await response.json()) as { error?: GoogleApiErrorPayload };
        payload = parsed?.error;
      } catch {
        // Response body wasn't JSON; surface the bare status instead.
      }
      throw new GoogleAdsApiError(response.status, payload);
    }
    const body = (await response.json()) as { resourceNames?: string[] };
    return (body.resourceNames ?? []).map((name) => name.replace("customers/", ""));
  } finally {
    clearTimeout(timeout);
  }
}
