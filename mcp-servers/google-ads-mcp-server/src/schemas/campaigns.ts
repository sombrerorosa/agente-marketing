import { z } from "zod";
import { paginationFields, responseFormatField, EntityStatusEnum } from "./common.js";

export const AdvertisingChannelTypeEnum = z.enum([
  "SEARCH",
  "DISPLAY",
  "SHOPPING",
  "VIDEO",
  "PERFORMANCE_MAX",
  "DEMAND_GEN",
]);

// The bidding strategies settable directly on the campaign (as opposed to a
// shared/portfolio bidding strategy resource) — covers the common cases
// without requiring a separate BiddingStrategy object.
export const BiddingStrategyEnum = z.enum([
  "MANUAL_CPC",
  "TARGET_SPEND",
  "MAXIMIZE_CONVERSIONS",
  "MAXIMIZE_CONVERSION_VALUE",
  "TARGET_CPA",
  "TARGET_ROAS",
]);

export const ListCampaignsInputSchema = z
  .object({
    status_filter: z.array(EntityStatusEnum).optional().describe("Only return campaigns whose status is one of these. Omit to return all."),
    name_contains: z.string().optional().describe("Substring filter on campaign name (GAQL LIKE)."),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();
export type ListCampaignsInput = z.infer<typeof ListCampaignsInputSchema>;

export const GetCampaignInputSchema = z
  .object({
    campaign_id: z.string().min(1).describe("Campaign ID, e.g. '20700000000'"),
    response_format: responseFormatField,
  })
  .strict();
export type GetCampaignInput = z.infer<typeof GetCampaignInputSchema>;

export const CreateCampaignInputSchema = z
  .object({
    name: z.string().min(1).max(255).describe("Campaign name"),
    advertising_channel_type: AdvertisingChannelTypeEnum.default("SEARCH").describe(
      "Which network this campaign runs on. There's no separate 'objective' field like other ad platforms — this is the closest equivalent."
    ),
    status: z.enum(["ENABLED", "PAUSED"]).default("PAUSED").describe("Initial status. Defaults to PAUSED so nothing spends until reviewed and explicitly enabled."),
    daily_budget_micros: z
      .number()
      .int()
      .positive()
      .describe("Daily budget in micros (currency unit × 1,000,000 — e.g. 5000000 = 5.00 in the account's currency). Unlike other platforms, Google Ads always budgets at the campaign level; there's no per-ad-group budget."),
    shared_budget: z
      .boolean()
      .default(false)
      .describe("Whether other campaigns can share this same budget resource. Leave false unless you're intentionally building a shared budget."),
    budget_delivery_method: z.enum(["STANDARD", "ACCELERATED"]).default("STANDARD"),
    bidding_strategy: BiddingStrategyEnum.default("MANUAL_CPC").describe(
      "MANUAL_CPC needs no conversion tracking and is the safest default. MAXIMIZE_CONVERSIONS/MAXIMIZE_CONVERSION_VALUE/TARGET_CPA/TARGET_ROAS all require conversion tracking to be set up on the account first, or the campaign will under-deliver."
    ),
    target_cpa_micros: z.number().int().positive().optional().describe("Required when bidding_strategy is TARGET_CPA. Target cost-per-acquisition in micros."),
    target_roas: z.number().positive().optional().describe("Required when bidding_strategy is TARGET_ROAS. Target return on ad spend as a ratio, e.g. 3.5 for 350%."),
    start_date: z.string().optional().describe("YYYY-MM-DD. Omit to start immediately on enabling."),
    end_date: z.string().optional().describe("YYYY-MM-DD. Omit for a campaign that runs until paused/removed."),
    response_format: responseFormatField,
  })
  .strict();
export type CreateCampaignInput = z.infer<typeof CreateCampaignInputSchema>;

export const UpdateCampaignInputSchema = z
  .object({
    campaign_id: z.string().min(1),
    name: z.string().min(1).max(255).optional(),
    status: z.enum(["ENABLED", "PAUSED", "REMOVED"]).optional().describe("Set to PAUSED to stop spend without removing the campaign."),
    daily_budget_micros: z.number().int().positive().optional(),
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
