import { z } from "zod";
import { paginationFields, responseFormatField, EffectiveStatusEnum } from "./common.js";

export const ObjectiveEnum = z.enum([
  "OUTCOME_AWARENESS",
  "OUTCOME_TRAFFIC",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_APP_PROMOTION",
  "OUTCOME_SALES",
]);

export const ListCampaignsInputSchema = z
  .object({
    status_filter: z
      .array(EffectiveStatusEnum)
      .optional()
      .describe("Only return campaigns whose effective_status is one of these. Omit to return all."),
    name_contains: z
      .string()
      .optional()
      .describe("Case-insensitive substring filter on campaign name, applied client-side."),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();
export type ListCampaignsInput = z.infer<typeof ListCampaignsInputSchema>;

export const GetCampaignInputSchema = z
  .object({
    campaign_id: z.string().min(1).describe("Campaign ID, e.g. '120211000000000'"),
    response_format: responseFormatField,
  })
  .strict();
export type GetCampaignInput = z.infer<typeof GetCampaignInputSchema>;

export const CreateCampaignInputSchema = z
  .object({
    name: z.string().min(1).max(400).describe("Campaign name"),
    objective: ObjectiveEnum.describe(
      "Campaign objective. Common values: OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES, OUTCOME_AWARENESS, OUTCOME_APP_PROMOTION"
    ),
    status: z
      .enum(["ACTIVE", "PAUSED"])
      .default("PAUSED")
      .describe("Initial status. Defaults to PAUSED so nothing spends until reviewed and explicitly activated."),
    daily_budget_cents: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Campaign-level daily budget in the ad account currency's minor unit (cents), for Campaign Budget Optimization. Omit if budgets will be set per ad set."
      ),
    lifetime_budget_cents: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Campaign-level lifetime budget in minor unit (cents). Do not combine with daily_budget_cents."),
    is_adset_budget_sharing_enabled: z
      .boolean()
      .optional()
      .describe(
        "Required by Meta when daily_budget_cents or lifetime_budget_cents is set (Advantage campaign budget / CBO). Controls whether ad sets under this campaign can flexibly share the campaign-level budget. Not applicable, and should be omitted, when budgets are set per ad set instead."
      ),
    buying_type: z.enum(["AUCTION", "RESERVED"]).default("AUCTION"),
    special_ad_categories: z
      .array(z.enum(["NONE", "EMPLOYMENT", "HOUSING", "CREDIT", "ISSUES_ELECTIONS_POLITICS"]))
      .default(["NONE"])
      .describe(
        "Required by Meta for regulatory compliance. Use NONE unless this campaign advertises housing, employment, credit, or social issues/elections — those categories have restricted targeting."
      ),
    response_format: responseFormatField,
  })
  .strict();
export type CreateCampaignInput = z.infer<typeof CreateCampaignInputSchema>;

export const UpdateCampaignInputSchema = z
  .object({
    campaign_id: z.string().min(1),
    name: z.string().min(1).max(400).optional(),
    status: z.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]).optional().describe("Set to PAUSED to stop spend without deleting."),
    daily_budget_cents: z.number().int().positive().optional(),
    lifetime_budget_cents: z.number().int().positive().optional(),
    response_format: responseFormatField,
  })
  .strict();
export type UpdateCampaignInput = z.infer<typeof UpdateCampaignInputSchema>;

export const DeleteCampaignInputSchema = z
  .object({
    campaign_id: z.string().min(1),
  })
  .strict();
export type DeleteCampaignInput = z.infer<typeof DeleteCampaignInputSchema>;
