import { z } from "zod";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../constants.js";

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

export const responseFormatField = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable");

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

export const EffectiveStatusEnum = z.enum([
  "ACTIVE",
  "PAUSED",
  "DELETED",
  "ARCHIVED",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
]);
