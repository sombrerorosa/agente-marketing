export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

/** One entry of the `errors` array Google nests inside a GoogleAdsFailure error detail. */
export interface GoogleAdsFailureError {
  errorCode: Record<string, string>;
  message: string;
  trigger?: Record<string, unknown>;
  location?: { fieldPathElements?: Array<{ fieldName: string; index?: number }> };
}

/** Shape of the top-level `error` object the Google Ads REST API returns on failure. */
export interface GoogleApiErrorPayload {
  code: number;
  message: string;
  status?: string;
  details?: Array<{
    "@type"?: string;
    errors?: GoogleAdsFailureError[];
    [key: string]: unknown;
  }>;
}

/** A single row from a googleAds:search response — nested per referenced resource. */
export type GaqlRow = Record<string, unknown>;

export interface GaqlSearchResponse {
  results?: GaqlRow[];
  nextPageToken?: string;
  totalResultsCount?: string;
  fieldMask?: string;
}

export interface MutateResult {
  resourceName: string;
}

export interface MutateResponse {
  results?: MutateResult[];
  partialFailureError?: GoogleApiErrorPayload;
}

/** Generic pagination envelope returned by our list_* tools. */
export interface PagedResult<T> {
  count: number;
  items: T[];
  has_more: boolean;
  next_cursor?: string;
}
