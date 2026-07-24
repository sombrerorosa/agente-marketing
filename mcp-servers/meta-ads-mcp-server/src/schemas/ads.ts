import { z } from "zod";
import { paginationFields, responseFormatField, EffectiveStatusEnum } from "./common.js";

export const ListAdsInputSchema = z
  .object({
    adset_id: z.string().optional().describe("Filter to ads belonging to this ad set."),
    campaign_id: z.string().optional().describe("Filter to ads belonging to this campaign. Ignored if adset_id is also provided."),
    status_filter: z.array(EffectiveStatusEnum).optional(),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();
export type ListAdsInput = z.infer<typeof ListAdsInputSchema>;

export const GetAdInputSchema = z
  .object({
    ad_id: z.string().min(1),
    response_format: responseFormatField,
  })
  .strict();
export type GetAdInput = z.infer<typeof GetAdInputSchema>;

export const CreateAdInputSchema = z
  .object({
    name: z.string().min(1).max(400),
    adset_id: z.string().min(1),
    creative_id: z.string().min(1).describe("Ad Creative ID from meta_ads_create_ad_creative."),
    status: z.enum(["ACTIVE", "PAUSED"]).default("PAUSED"),
    response_format: responseFormatField,
  })
  .strict();
export type CreateAdInput = z.infer<typeof CreateAdInputSchema>;

export const UpdateAdInputSchema = z
  .object({
    ad_id: z.string().min(1),
    name: z.string().min(1).max(400).optional(),
    status: z.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]).optional(),
    creative_id: z.string().optional().describe("Swap in a different Ad Creative without recreating the ad."),
    response_format: responseFormatField,
  })
  .strict();
export type UpdateAdInput = z.infer<typeof UpdateAdInputSchema>;

export const DeleteAdInputSchema = z
  .object({
    ad_id: z.string().min(1),
  })
  .strict();
export type DeleteAdInput = z.infer<typeof DeleteAdInputSchema>;
