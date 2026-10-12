// Google ships a new major API version roughly every 3 months and sunsets
// each one about a year after release — check
// https://developers.google.com/google-ads/api/docs/sunset-dates before
// relying on this default for long; override with GOOGLE_ADS_API_VERSION.
export const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v25";
export const GOOGLE_ADS_BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
export const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

// Keep tool responses well under typical model context windows.
export const CHARACTER_LIMIT = 25000;

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

// Refresh the cached OAuth access token this long before its reported
// expiry, so a request never starts with a token that expires mid-flight.
export const TOKEN_REFRESH_SAFETY_MARGIN_MS = 60_000;

export const RATE_LIMIT_MAX_RETRIES = 3;
export const RATE_LIMIT_BASE_DELAY_MS = 2000;

// Customer Match user lists: Google's own ceiling on membership_life_span
// (days a member stays in the list without a fresh upload).
export const MAX_MEMBERSHIP_LIFE_SPAN_DAYS = 540;
