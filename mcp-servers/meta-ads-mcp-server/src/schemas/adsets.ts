import { z } from "zod";
import { paginationFields, responseFormatField, EffectiveStatusEnum } from "./common.js";

export const TargetingSchema = z
  .object({
    countries: z
      .array(z.string().length(2))
      .optional()
      .describe("ISO 3166-1 alpha-2 country codes, e.g. ['AR','UY','CL']"),
    age_min: z.number().int().min(13).max(65).optional(),
    age_max: z.number().int().min(13).max(65).optional(),
    genders: z
      .array(z.number().int().min(1).max(2))
      .optional()
      .describe("1=male, 2=female. Omit or leave empty for all genders."),
    interest_ids: z
      .array(z.string())
      .optional()
      .describe("Meta interest/behavior targeting IDs, looked up via Meta's Targeting Search (Ads Manager or /search edge)."),
    custom_audience_ids: z.array(z.string()).optional().describe("Custom/Lookalike Audience IDs to include."),
    excluded_custom_audience_ids: z.array(z.string()).optional().describe("Custom Audience IDs to exclude."),
    advantage_audience: z
      .boolean()
      .default(false)
      .describe("Enable Meta's AI-expanded 'Advantage+ audience' targeting on top of the manual criteria above."),
  })
  .strict();
export type Targeting = z.infer<typeof TargetingSchema>;

const OptimizationGoalEnum = z.enum([
  "LINK_CLICKS",
  "IMPRESSIONS",
  "REACH",
  "LANDING_PAGE_VIEWS",
  "OFFSITE_CONVERSIONS",
  "THRUPLAY",
  "APP_INSTALLS",
  "CONVERSATIONS",
  "VALUE",
]);

const BillingEventEnum = z.enum(["IMPRESSIONS", "LINK_CLICKS", "THRUPLAY"]);

const BidStrategyEnum = z.enum(["LOWEST_COST_WITHOUT_CAP", "LOWEST_COST_WITH_BID_CAP", "COST_CAP"]);

export const ListAdSetsInputSchema = z
  .object({
    campaign_id: z.string().optional().describe("Filter to ad sets belonging to this campaign. Omit to list across the whole ad account."),
    status_filter: z.array(EffectiveStatusEnum).optional(),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();
export type ListAdSetsInput = z.infer<typeof ListAdSetsInputSchema>;

export const GetAdSetInputSchema = z
  .object({
    adset_id: z.string().min(1),
    response_format: responseFormatField,
  })
  .strict();
export type GetAdSetInput = z.infer<typeof GetAdSetInputSchema>;

export const CreateAdSetInputSchema = z
  .object({
    name: z.string().min(1).max(400),
    campaign_id: z.string().min(1),
    status: z.enum(["ACTIVE", "PAUSED"]).default("PAUSED"),
    daily_budget_cents: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Required unless the campaign uses Campaign Budget Optimization or lifetime_budget_cents is set."),
    lifetime_budget_cents: z.number().int().positive().optional(),
    optimization_goal: OptimizationGoalEnum,
    billing_event: BillingEventEnum,
    bid_strategy: BidStrategyEnum.default("LOWEST_COST_WITHOUT_CAP"),
    bid_amount_cents: z.number().int().positive().optional().describe("Required when bid_strategy is LOWEST_COST_WITH_BID_CAP or COST_CAP."),
    targeting: TargetingSchema,
    start_time: z.string().optional().describe("ISO 8601 datetime, e.g. '2026-08-01T00:00:00-0300'. Omit to start immediately on activation."),
    end_time: z.string().optional().describe("ISO 8601 datetime. Omit for an ad set that runs until paused."),
    promoted_object: z
      .record(z.unknown())
      .optional()
      .describe(
        "Required when optimization_goal is OFFSITE_CONVERSIONS or APP_INSTALLS, e.g. { pixel_id: '...', custom_event_type: 'PURCHASE' } or { application_id: '...', object_store_url: '...' }."
      ),
    response_format: responseFormatField,
  })
  .strict();
export type CreateAdSetInput = z.infer<typeof CreateAdSetInputSchema>;

export const UpdateAdSetInputSchema = z
  .object({
    adset_id: z.string().min(1),
    name: z.string().min(1).max(400).optional(),
    status: z.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]).optional(),
    daily_budget_cents: z.number().int().positive().optional(),
    lifetime_budget_cents: z.number().int().positive().optional(),
    bid_amount_cents: z.number().int().positive().optional(),
    targeting: TargetingSchema.optional(),
    response_format: responseFormatField,
  })
  .strict();
export type UpdateAdSetInput = z.infer<typeof UpdateAdSetInputSchema>;

export const DeleteAdSetInputSchema = z
  .object({
    adset_id: z.string().min(1),
  })
  .strict();
export type DeleteAdSetInput = z.infer<typeof DeleteAdSetInputSchema>;

export function buildTargetingPayload(t: Targeting): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (t.countries?.length) payload.geo_locations = { countries: t.countries };
  if (t.age_min !== undefined) payload.age_min = t.age_min;
  if (t.age_max !== undefined) payload.age_max = t.age_max;
  if (t.genders?.length) payload.genders = t.genders;
  if (t.interest_ids?.length) {
    payload.flexible_spec = [{ interests: t.interest_ids.map((id) => ({ id })) }];
  }
  if (t.custom_audience_ids?.length) {
    payload.custom_audiences = t.custom_audience_ids.map((id) => ({ id }));
  }
  if (t.excluded_custom_audience_ids?.length) {
    payload.excluded_custom_audiences = t.excluded_custom_audience_ids.map((id) => ({ id }));
  }
  payload.targeting_automation = { advantage_audience: t.advantage_audience ? 1 : 0 };
  return payload;
}
