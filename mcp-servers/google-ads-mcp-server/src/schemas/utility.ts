import { z } from "zod";
import { customerIdField, responseFormatField } from "./common.js";

export const GetCustomerInputSchema = z
  .object({
    customer_id: customerIdField,
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
