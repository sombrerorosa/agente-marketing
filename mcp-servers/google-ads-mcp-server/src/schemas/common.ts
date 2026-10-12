import { z } from "zod";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../constants.js";

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

export const responseFormatField = z
  .enum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable");

export const customerIdField = z
  .string()
  .optional()
  .describe(
    "Override GOOGLE_ADS_CUSTOMER_ID for this call — the Customer ID of a different account the configured OAuth user (or its MCC) can access, e.g. to manage a client account without redeploying. Digits only; dashes are stripped either way. Use google_ads_list_accessible_customers to find it."
  );

export const paginationFields = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_LIMIT)
    .default(DEFAULT_PAGE_LIMIT)
    .describe(`Maximum results to return (1-${MAX_PAGE_LIMIT}, default ${DEFAULT_PAGE_LIMIT})`),
  after: z
    .string()
    .optional()
    .describe("Pagination cursor from a previous call's next_cursor field. Omit to get the first page."),
};

// Google's actual mutable status on campaigns/ad groups/ads/criteria.
// There's no separate ARCHIVED — REMOVED is permanent and is what both
// "delete" and "archive" map to.
export const EntityStatusEnum = z.enum(["ENABLED", "PAUSED", "REMOVED"]);

// Read-only rollup Google computes from status plus policy/serving signals
// (ad approval, budget, limited by policy, etc.) — useful as a list/get
// filter, not something you can set directly.
export const PrimaryStatusEnum = z.enum([
  "ELIGIBLE",
  "PAUSED",
  "REMOVED",
  "PENDING",
  "LIMITED",
  "LEARNING",
  "NOT_ELIGIBLE",
]);
