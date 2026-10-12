import { z } from "zod";
import { responseFormatField } from "./common.js";

export const GetCustomerInputSchema = z
  .object({
    response_format: responseFormatField,
  })
  .strict();
export type GetCustomerInput = z.infer<typeof GetCustomerInputSchema>;

export const ListAccessibleCustomersInputSchema = z
  .object({
    response_format: responseFormatField,
  })
  .strict();
export type ListAccessibleCustomersInput = z.infer<typeof ListAccessibleCustomersInputSchema>;
