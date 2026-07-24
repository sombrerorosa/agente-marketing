import { z } from "zod";
import { paginationFields, responseFormatField } from "./common.js";

export const LevelEnum = z.enum(["account", "campaign", "adset", "ad"]);

export const DatePresetEnum = z.enum([
  "today",
  "yesterday",
  "last_7d",
  "last_14d",
  "last_28d",
  "last_30d",
  "last_90d",
  "this_month",
  "last_month",
  "maximum",
]);

export const BreakdownEnum = z.enum(["age", "gender", "country", "region", "publisher_platform", "platform_position", "device_platform"]);

const DEFAULT_FIELDS = ["spend", "impressions", "clicks", "ctr", "cpc", "cpm", "reach", "frequency", "actions", "purchase_roas"];

export const GetInsightsInputSchema = z
  .object({
    object_id: z
      .string()
      .optional()
      .describe("Campaign, ad set, or ad ID to scope the report to. Omit to report on the whole ad account (requires 'level')."),
    level: LevelEnum.default("campaign").describe("Aggregation level. Required (and used as-is) when object_id is omitted; when object_id is set, it controls whether results are rolled up or broken out by child objects."),
    date_preset: DatePresetEnum.optional().describe("Relative date range, e.g. 'last_30d'. Provide this OR since/until, not both."),
    since: z.string().optional().describe("Custom range start, 'YYYY-MM-DD'. Requires until."),
    until: z.string().optional().describe("Custom range end, 'YYYY-MM-DD'. Requires since."),
    fields: z
      .array(z.string())
      .optional()
      .describe(`Metrics to return. Defaults to: ${DEFAULT_FIELDS.join(", ")}. See Meta's Ads Insights API reference for the full field list.`),
    breakdowns: z.array(BreakdownEnum).optional().describe("Split results by dimension, e.g. ['age','gender']. At most 2 recommended."),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();
export type GetInsightsInput = z.infer<typeof GetInsightsInputSchema>;

export { DEFAULT_FIELDS };
