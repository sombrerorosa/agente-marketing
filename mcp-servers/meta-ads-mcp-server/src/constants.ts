export const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v21.0";
export const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// Keep tool responses well under typical model context windows.
export const CHARACTER_LIMIT = 25000;

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

// Usage-header thresholds above which we proactively slow down instead of
// waiting for Meta to return a 429. See services/graphApiClient.ts.
export const USAGE_BACKOFF_THRESHOLD_PCT = 90;
export const RATE_LIMIT_MAX_RETRIES = 3;
export const RATE_LIMIT_BASE_DELAY_MS = 2000;
