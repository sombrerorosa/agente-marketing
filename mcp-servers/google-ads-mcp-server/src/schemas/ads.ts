import { z } from "zod";
import { paginationFields, responseFormatField, EntityStatusEnum } from "./common.js";

const HeadlinePinEnum = z.enum(["HEADLINE_1", "HEADLINE_2", "HEADLINE_3"]);
const DescriptionPinEnum = z.enum(["DESCRIPTION_1", "DESCRIPTION_2"]);

export const HeadlineInputSchema = z
  .object({
    text: z.string().min(1).max(30).describe("Max 30 characters."),
    pinned_position: HeadlinePinEnum.optional().describe("Pin this headline to always show in a specific slot. Omit to let Google choose the best-performing combination."),
  })
  .strict();

export const DescriptionInputSchema = z
  .object({
    text: z.string().min(1).max(90).describe("Max 90 characters."),
    pinned_position: DescriptionPinEnum.optional(),
  })
  .strict();

export const ListAdsInputSchema = z
  .object({
    ad_group_id: z.string().optional().describe("Filter to ads belonging to this ad group."),
    campaign_id: z.string().optional().describe("Filter to ads belonging to this campaign. Ignored if ad_group_id is also provided."),
    status_filter: z.array(EntityStatusEnum).optional(),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();
export type ListAdsInput = z.infer<typeof ListAdsInputSchema>;

// Google's ad resource name is composite (ad_group_id~ad_id) — unlike a
// flat ad_id, there's no way to look one up without also knowing its ad
// group, so both are required everywhere below.
export const GetAdInputSchema = z
  .object({
    ad_group_id: z.string().min(1),
    ad_id: z.string().min(1),
    response_format: responseFormatField,
  })
  .strict();
export type GetAdInput = z.infer<typeof GetAdInputSchema>;

export const CreateAdInputSchema = z
  .object({
    ad_group_id: z.string().min(1),
    final_urls: z.array(z.string().url()).min(1).describe("Landing page URL(s) shown when the ad is clicked."),
    headlines: z.array(HeadlineInputSchema).min(3).max(15).describe("3-15 headlines, max 30 chars each. Google rotates/combines these automatically."),
    descriptions: z.array(DescriptionInputSchema).min(2).max(4).describe("2-4 descriptions, max 90 chars each."),
    path1: z.string().max(15).optional().describe("First path segment shown after the domain in the displayed URL, e.g. 'ofertas'."),
    path2: z.string().max(15).optional().describe("Second path segment. Requires path1."),
    status: z.enum(["ENABLED", "PAUSED"]).default("PAUSED"),
    response_format: responseFormatField,
  })
  .strict();
export type CreateAdInput = z.infer<typeof CreateAdInputSchema>;

export const UpdateAdInputSchema = z
  .object({
    ad_group_id: z.string().min(1),
    ad_id: z.string().min(1),
    status: z.enum(["ENABLED", "PAUSED", "REMOVED"]).describe(
      "Headline/description/URL content is immutable once created — to change ad copy, remove this ad and create a new one. This tool only flips status."
    ),
    response_format: responseFormatField,
  })
  .strict();
export type UpdateAdInput = z.infer<typeof UpdateAdInputSchema>;

export const DeleteAdInputSchema = z
  .object({
    ad_group_id: z.string().min(1),
    ad_id: z.string().min(1),
  })
  .strict();
export type DeleteAdInput = z.infer<typeof DeleteAdInputSchema>;
