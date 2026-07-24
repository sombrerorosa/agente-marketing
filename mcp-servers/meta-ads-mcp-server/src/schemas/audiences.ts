import { z } from "zod";
import { paginationFields, responseFormatField } from "./common.js";

export const CreateCustomAudienceInputSchema = z
  .object({
    name: z.string().min(1).max(400),
    description: z.string().optional(),
    customer_file_source: z
      .enum(["USER_PROVIDED_ONLY", "PARTNER_PROVIDED_ONLY", "BOTH_USER_AND_PARTNER_PROVIDED"])
      .default("USER_PROVIDED_ONLY")
      .describe("How the data in this audience was collected — required by Meta for data-source disclosure."),
    response_format: responseFormatField,
  })
  .strict();
export type CreateCustomAudienceInput = z.infer<typeof CreateCustomAudienceInputSchema>;

export const CreateLookalikeAudienceInputSchema = z
  .object({
    name: z.string().min(1).max(400),
    origin_audience_id: z.string().min(1).describe("The Custom Audience ID this lookalike is modeled on."),
    country: z.string().length(2).describe("ISO 3166-1 alpha-2 country code the lookalike will be built for, e.g. 'AR'."),
    ratio: z
      .number()
      .min(0.01)
      .max(0.2)
      .default(0.05)
      .describe("Audience size as a fraction of the country's population, from 0.01 (closest match, smallest) to 0.20 (broadest)."),
    response_format: responseFormatField,
  })
  .strict();
export type CreateLookalikeAudienceInput = z.infer<typeof CreateLookalikeAudienceInputSchema>;

export const ListAudiencesInputSchema = z
  .object({
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();
export type ListAudiencesInput = z.infer<typeof ListAudiencesInputSchema>;

export const DeleteAudienceInputSchema = z
  .object({
    audience_id: z.string().min(1),
  })
  .strict();
export type DeleteAudienceInput = z.infer<typeof DeleteAudienceInputSchema>;
