import type { GoogleApiErrorPayload } from "../types.js";

/** Error thrown by googleAdsClient for any non-2xx Google Ads API response. */
export class GoogleAdsApiError extends Error {
  readonly status: number;
  readonly payload?: GoogleApiErrorPayload;

  constructor(status: number, payload?: GoogleApiErrorPayload) {
    super(payload?.message || `Google Ads API request failed with HTTP status ${status}`);
    this.name = "GoogleAdsApiError";
    this.status = status;
    this.payload = payload;
  }
}

export function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof GoogleAdsApiError)) return false;
  if (error.status === 429) return true;
  return error.payload?.status === "RESOURCE_EXHAUSTED";
}

function describeGoogleAdsFailure(payload: GoogleApiErrorPayload): string | undefined {
  const failures = payload.details?.flatMap((d) => d.errors ?? []) ?? [];
  if (!failures.length) return undefined;
  return failures
    .map((f) => {
      const [category, reason] = Object.entries(f.errorCode)[0] ?? ["error", "UNKNOWN"];
      const field = f.location?.fieldPathElements?.map((p) => p.fieldName).join(".");
      return `${category}.${reason}: ${f.message}${field ? ` (field: ${field})` : ""}`;
    })
    .join("; ");
}

/**
 * Turns a raw Google Ads API error into a message that tells the calling
 * agent what actually went wrong and what to try next. Google's errors are
 * gRPC-status-shaped (code/status/message) with the actionable detail
 * buried in details[].errors[] (a GoogleAdsFailure) — very different from a
 * flat HTTP status, so we unwrap that before surfacing anything.
 */
export function handleGoogleAdsError(error: unknown): string {
  if (error instanceof GoogleAdsApiError) {
    const payload = error.payload;
    if (!payload) {
      return `Error: Google Ads API request failed with HTTP status ${error.status}`;
    }

    const detail = describeGoogleAdsFailure(payload);

    if (payload.status === "UNAUTHENTICATED" || error.status === 401) {
      return `Error: OAuth access token rejected. The refresh token may have been revoked, or GOOGLE_ADS_CLIENT_ID/GOOGLE_ADS_CLIENT_SECRET don't match the one it was issued for. Regenerate GOOGLE_ADS_REFRESH_TOKEN.${detail ? ` Detail: ${detail}` : ""}`;
    }
    if (payload.status === "PERMISSION_DENIED" || error.status === 403) {
      return `Error: Permission denied — ${detail ?? payload.message}. Check that this Google account has access to GOOGLE_ADS_CUSTOMER_ID, that GOOGLE_ADS_LOGIN_CUSTOMER_ID is set if it's a client account under an MCC, and that the Cloud project has at least Basic access level.`;
    }
    if (payload.status === "RESOURCE_EXHAUSTED") {
      return `Error: Rate limit / quota exceeded. The client already retried with backoff; wait a bit longer before retrying manually.${detail ? ` Detail: ${detail}` : ""}`;
    }
    if (payload.status === "INVALID_ARGUMENT") {
      return `Error: Invalid argument — ${detail ?? payload.message}`;
    }
    return `Error: Google Ads API request failed — ${detail ?? payload.message} (status ${payload.status ?? error.status})`;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return "Error: Request to Google Ads API timed out. Try again.";
  }
  if (error instanceof TypeError) {
    return `Error: Network error contacting Google Ads API — ${error.message}`;
  }

  return `Error: Unexpected error — ${error instanceof Error ? error.message : String(error)}`;
}
