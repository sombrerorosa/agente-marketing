import { z } from "zod";
import { paginationFields, responseFormatField, EntityStatusEnum } from "./common.js";

export const AdGroupTypeEnum = z.enum(["SEARCH_STANDARD", "DISPLAY_STANDARD", "VIDEO_TRUE_VIEW_IN_STREAM", "SHOPPING_PRODUCT_ADS"]);

export const ListAdGroupsInputSchema = z
  .object({
    campaign_id: z.string().optional().describe("Filter to ad groups belonging to this campaign. Omit to list across the whole account."),
    status_filter: z.array(EntityStatusEnum).optional(),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();
export type ListAdGroupsInput = z.infer<typeof ListAdGroupsInputSchema>;

export const GetAdGroupInputSchema = z
  .object({
    ad_group_id: z.string().min(1),
    response_format: responseFormatField,
  })
  .strict();
export type GetAdGroupInput = z.infer<typeof GetAdGroupInputSchema>;

export const CreateAdGroupInputSchema = z
  .object({
    name: z.string().min(1).max(255),
    campaign_id: z.string().min(1),
    status: z.enum(["ENABLED", "PAUSED"]).default("PAUSED"),
    type: AdGroupTypeEnum.default("SEARCH_STANDARD"),
    cpc_bid_micros: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Max CPC bid in micros (currency unit × 1,000,000). Only meaningful when the campaign's bidding_strategy is MANUAL_CPC — omit otherwise, Google will reject it as an unused field on some strategies."),
    response_format: responseFormatField,
  })
  .strict();
export type CreateAdGroupInput = z.infer<typeof CreateAdGroupInputSchema>;

export const UpdateAdGroupInputSchema = z
  .object({
    ad_group_id: z.string().min(1),
    name: z.string().min(1).max(255).optional(),
    status: z.enum(["ENABLED", "PAUSED", "REMOVED"]).optional(),
    cpc_bid_micros: z.number().int().positive().optional(),
    response_format: responseFormatField,
  })
  .strict();
export type UpdateAdGroupInput = z.infer<typeof UpdateAdGroupInputSchema>;

export const DeleteAdGroupInputSchema = z
  .object({
    ad_group_id: z.string().min(1),
  })
  .strict();
export type DeleteAdGroupInput = z.infer<typeof DeleteAdGroupInputSchema>;
