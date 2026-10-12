import { z } from "zod";
import { customerIdField, paginationFields, responseFormatField } from "./common.js";

export const LevelEnum = z.enum(["account", "campaign", "ad_group", "ad"]);

// Google Ads' built-in GAQL date-range keywords (a subset — see "DURING" in
// the GAQL date range docs for the full list).
export const DatePresetEnum = z.enum(["TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "THIS_MONTH", "LAST_MONTH"]);

export const BreakdownEnum = z.enum(["day", "device", "age_range", "gender"]);

const DEFAULT_METRICS = [
  "metrics.impressions",
  "metrics.clicks",
  "metrics.cost_micros",
  "metrics.ctr",
  "metrics.average_cpc",
  "metrics.conversions",
  "metrics.conversions_value",
];

export const GetInsightsInputSchema = z
  .object({
    level: LevelEnum.default("campaign").describe("Output granularity — which resource each row represents. 'account' has no further scoping below."),
    campaign_id: z.string().optional().describe("Scope to one campaign. Valid at any level except 'account'."),
    ad_group_id: z.string().optional().describe("Scope to one ad group. Valid only when level is 'ad_group' or 'ad'."),
    ad_id: z.string().optional().describe("Scope to one ad. Requires ad_group_id, and only valid when level is 'ad'."),
    date_preset: DatePresetEnum.optional().describe("Relative date range. Provide this OR since/until, not both."),
    since: z.string().optional().describe("Custom range start, 'YYYY-MM-DD'. Requires until."),
    until: z.string().optional().describe("Custom range end, 'YYYY-MM-DD'. Requires since."),
    metrics: z.array(z.string()).optional().describe(`Metric fields to return, e.g. 'metrics.impressions'. Defaults to: ${DEFAULT_METRICS.join(", ")}.`),
    breakdowns: z.array(BreakdownEnum).optional().describe("Split results by segment, e.g. ['device']. At most 2 recommended to avoid combinatorial blowup."),
    ...paginationFields,
    customer_id: customerIdField,
    response_format: responseFormatField,
  })
  .strict();
export type GetInsightsInput = z.infer<typeof GetInsightsInputSchema>;

export { DEFAULT_METRICS };
