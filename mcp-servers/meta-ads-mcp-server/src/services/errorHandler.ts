import axios from "axios";
import type { GraphApiErrorPayload } from "../types.js";

// Meta error codes/subcodes that indicate throttling rather than a real
// client error. See https://developers.facebook.com/docs/graph-api/guides/error-handling
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const RATE_LIMIT_SUBCODES = new Set([2446079, 1487742]);

export function extractGraphApiError(error: unknown): GraphApiErrorPayload | undefined {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data as { error?: GraphApiErrorPayload } | undefined;
    return payload?.error;
  }
  return undefined;
}

export function isRateLimitError(error: unknown): boolean {
  const gError = extractGraphApiError(error);
  if (!gError) return axios.isAxiosError(error) && error.response?.status === 429;
  if (RATE_LIMIT_CODES.has(gError.code)) return true;
  if (gError.error_subcode && RATE_LIMIT_SUBCODES.has(gError.error_subcode)) return true;
  return false;
}

/**
 * Turns a raw Graph API error into a message that tells the calling agent
 * what actually went wrong and what to try next, instead of a bare HTTP
 * status code — Meta's errors don't map cleanly onto HTTP semantics (e.g.
 * an expired token and a missing permission can both come back as 400).
 */
export function handleGraphApiError(error: unknown): string {
  const gError = extractGraphApiError(error);

  if (gError) {
    const trace = gError.fbtrace_id ? ` (fbtrace_id: ${gError.fbtrace_id})` : "";

    if (gError.code === 190) {
      return `Error: Meta access token is invalid or expired. Regenerate the System User token in Business Settings and update META_ACCESS_TOKEN.${trace}`;
    }
    if (gError.code === 200 || gError.code === 10) {
      return `Error: Permission denied — "${gError.message}". Check that the System User has both the required scope (e.g. ads_management) and the ad account/Page assigned as an asset.${trace}`;
    }
    if (gError.code === 100) {
      return `Error: Invalid parameter — ${gError.error_user_msg || gError.message}${trace}`;
    }
    if (RATE_LIMIT_CODES.has(gError.code)) {
      return `Error: Rate limit exceeded (code ${gError.code}). The client already retried with backoff; wait a bit longer before retrying manually.${trace}`;
    }
    if (gError.code === 2635) {
      return `Error: This Graph API version has been deprecated. Update GRAPH_API_VERSION in the server's environment.${trace}`;
    }
    return `Error: Graph API request failed — ${gError.message} (code ${gError.code}${gError.error_subcode ? `, subcode ${gError.error_subcode}` : ""})${trace}`;
  }

  if (axios.isAxiosError(error)) {
    if (error.code === "ECONNABORTED") {
      return "Error: Request to Graph API timed out. Try again.";
    }
    if (error.response) {
      return `Error: Graph API request failed with HTTP status ${error.response.status}`;
    }
    return `Error: Network error contacting Graph API — ${error.message}`;
  }

  return `Error: Unexpected error — ${error instanceof Error ? error.message : String(error)}`;
}
