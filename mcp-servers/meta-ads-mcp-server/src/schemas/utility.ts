import { z } from "zod";
import { paginationFields, responseFormatField } from "./common.js";

export const GetAdAccountInputSchema = z
  .object({
    response_format: responseFormatField,
  })
  .strict();
export type GetAdAccountInput = z.infer<typeof GetAdAccountInputSchema>;

export const ListPagesInputSchema = z
  .object({
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();
export type ListPagesInput = z.infer<typeof ListPagesInputSchema>;

export const GetInstagramAccountInputSchema = z
  .object({
    page_id: z.string().min(1).describe("Facebook Page ID. Use meta_ads_list_pages to find it."),
    response_format: responseFormatField,
  })
  .strict();
export type GetInstagramAccountInput = z.infer<typeof GetInstagramAccountInputSchema>;

export const DeleteOrganicContentInputSchema = z
  .object({
    id: z.string().min(1).describe("A Facebook post/photo/video id. Instagram media can't be deleted via this API — see the tool description."),
  })
  .strict();
export type DeleteOrganicContentInput = z.infer<typeof DeleteOrganicContentInputSchema>;

export const GetTokenPermissionsInputSchema = z
  .object({
    response_format: responseFormatField,
  })
  .strict();
export type GetTokenPermissionsInput = z.infer<typeof GetTokenPermissionsInputSchema>;
