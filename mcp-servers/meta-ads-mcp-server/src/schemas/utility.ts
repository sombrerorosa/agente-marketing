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
