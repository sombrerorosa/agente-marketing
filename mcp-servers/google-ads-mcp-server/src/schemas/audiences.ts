import { z } from "zod";
import { MAX_MEMBERSHIP_LIFE_SPAN_DAYS } from "../constants.js";
import { customerIdField, paginationFields, responseFormatField } from "./common.js";

export const CreateCustomerMatchListInputSchema = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().max(2048).optional(),
    membership_life_span_days: z
      .number()
      .int()
      .min(0)
      .max(MAX_MEMBERSHIP_LIFE_SPAN_DAYS)
      .default(MAX_MEMBERSHIP_LIFE_SPAN_DAYS)
      .describe(`Days a member stays in the list without a fresh upload (0-${MAX_MEMBERSHIP_LIFE_SPAN_DAYS}; 0 means members never expire). Defaults to the maximum.`),
    customer_id: customerIdField,
    response_format: responseFormatField,
  })
  .strict();
export type CreateCustomerMatchListInput = z.infer<typeof CreateCustomerMatchListInputSchema>;

export const ListUserListsInputSchema = z
  .object({
    ...paginationFields,
    customer_id: customerIdField,
    response_format: responseFormatField,
  })
  .strict();
export type ListUserListsInput = z.infer<typeof ListUserListsInputSchema>;

export const GetUserListInputSchema = z
  .object({
    user_list_id: z.string().min(1),
    customer_id: customerIdField,
    response_format: responseFormatField,
  })
  .strict();
export type GetUserListInput = z.infer<typeof GetUserListInputSchema>;

export const DeleteUserListInputSchema = z
  .object({
    user_list_id: z.string().min(1),
    customer_id: customerIdField,
  })
  .strict();
export type DeleteUserListInput = z.infer<typeof DeleteUserListInputSchema>;
