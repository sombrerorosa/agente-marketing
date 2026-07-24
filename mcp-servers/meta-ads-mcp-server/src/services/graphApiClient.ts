import axios, { AxiosInstance } from "axios";
import FormData from "form-data";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  GRAPH_API_BASE_URL,
  MAX_PAGE_LIMIT,
  RATE_LIMIT_BASE_DELAY_MS,
  RATE_LIMIT_MAX_RETRIES,
  USAGE_BACKOFF_THRESHOLD_PCT,
} from "../constants.js";
import { isRateLimitError } from "./errorHandler.js";
import type { GraphApiListResponse, PagedResult } from "../types.js";

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

const client: AxiosInstance = axios.create({
  baseURL: GRAPH_API_BASE_URL,
  timeout: 60000,
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Meta reports quota consumption via response headers (values are JSON,
 * shape varies by header) rather than a single rate-limit-remaining number.
 * We just look for the highest percentage figure and warn on stderr so the
 * operator can see it coming before a hard 429.
 */
function warnIfNearingUsageLimit(headers: Record<string, unknown>): void {
  const usageHeaderNames = ["x-business-use-case-usage", "x-ad-account-usage", "x-app-usage"];
  for (const name of usageHeaderNames) {
    const raw = headers[name];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(String(raw));
      const values: number[] = [];
      const collect = (node: unknown): void => {
        if (node && typeof node === "object") {
          for (const v of Object.values(node as Record<string, unknown>)) {
            if (typeof v === "number") values.push(v);
            else collect(v);
          }
        } else if (Array.isArray(node)) {
          for (const item of node) collect(item);
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
  data?: Record<string, unknown> | FormData;
  headers?: Record<string, string>;
}

/**
 * Core request function used by every tool. Injects auth via the
 * Authorization header (not the access_token query param, so the token
 * never ends up in request-URL logs), and retries on throttling with
 * exponential backoff before giving up and letting the caller see the
 * Graph API error.
 */
export async function graphRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", params = {}, data, headers = {} } = options;
  let attempt = 0;

  while (true) {
    try {
      const response = await client.request<T>({
        url: endpoint,
        method,
        params,
        data,
        headers: {
          Authorization: `Bearer ${getAccessToken()}`,
          ...headers,
        },
      });
      warnIfNearingUsageLimit(response.headers as Record<string, unknown>);
      return response.data;
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

/**
 * Uploads a local file (adimages/advideos) as multipart form data. Prefer
 * `uploadMediaFromUrl` when the asset is already reachable over HTTPS —
 * Meta fetches it server-side and this avoids reading the file into memory.
 */
export async function uploadMediaFile<T>(
  endpoint: string,
  filePath: string,
  fileFieldName: string,
  extraFields: Record<string, string> = {}
): Promise<T> {
  const form = new FormData();
  form.append(fileFieldName, readFileSync(filePath), basename(filePath));
  for (const [key, value] of Object.entries(extraFields)) {
    form.append(key, value);
  }
  return graphRequest<T>(endpoint, {
    method: "POST",
    data: form,
    headers: form.getHeaders(),
  });
}
