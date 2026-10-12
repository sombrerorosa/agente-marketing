import { z } from "zod";
import { customerIdField, paginationFields, responseFormatField } from "./common.js";

export const KeywordMatchTypeEnum = z.enum(["EXACT", "PHRASE", "BROAD"]);

export const KeywordInputSchema = z
  .object({
    text: z.string().min(1).max(80),
    match_type: KeywordMatchTypeEnum.default("BROAD"),
  })
  .strict();

export const AddKeywordsInputSchema = z
  .object({
    ad_group_id: z.string().min(1),
    keywords: z.array(KeywordInputSchema).min(1).max(20).describe("Up to 20 keywords per call — Google Ads caps mutate batches, and keeping it small makes partial failures easier to diagnose."),
    negative: z.boolean().default(false).describe("true adds these as negative keywords on the ad group (excluded from matching) instead of regular targeting keywords."),
    customer_id: customerIdField,
    response_format: responseFormatField,
  })
  .strict();
export type AddKeywordsInput = z.infer<typeof AddKeywordsInputSchema>;

export const ListKeywordsInputSchema = z
  .object({
    ad_group_id: z.string().min(1).describe("Ad group to list keywords from."),
    negative_only: z.boolean().default(false).describe("true lists only negative keywords on this ad group."),
    ...paginationFields,
    customer_id: customerIdField,
    response_format: responseFormatField,
  })
  .strict();
export type ListKeywordsInput = z.infer<typeof ListKeywordsInputSchema>;

export const RemoveKeywordInputSchema = z
  .object({
    ad_group_id: z.string().min(1),
    criterion_id: z.string().min(1).describe("ad_group_criterion.criterion_id, from google_ads_list_keywords."),
    customer_id: customerIdField,
  })
  .strict();
export type RemoveKeywordInput = z.infer<typeof RemoveKeywordInputSchema>;

export const AddCampaignNegativeKeywordsInputSchema = z
  .object({
    campaign_id: z.string().min(1),
    keywords: z.array(KeywordInputSchema).min(1).max(20),
    customer_id: customerIdField,
    response_format: responseFormatField,
  })
  .strict();
export type AddCampaignNegativeKeywordsInput = z.infer<typeof AddCampaignNegativeKeywordsInputSchema>;
