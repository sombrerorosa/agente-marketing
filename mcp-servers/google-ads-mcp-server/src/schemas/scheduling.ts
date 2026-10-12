import { z } from "zod";
import { customerIdField, responseFormatField } from "./common.js";

export const DayOfWeekEnum = z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]);
const ALL_DAYS = DayOfWeekEnum.options;

// Google's ad schedule only supports quarter-hour granularity for minutes.
export const MinuteOfHourEnum = z.enum(["ZERO", "FIFTEEN", "THIRTY", "FORTY_FIVE"]);

export const AddCampaignAdScheduleInputSchema = z
  .object({
    campaign_id: z.string().min(1),
    start_hour: z.number().int().min(0).max(23).describe("0-23, the hour this window starts (24h clock)."),
    start_minute: MinuteOfHourEnum.default("ZERO"),
    end_hour: z.number().int().min(0).max(24).describe("0-24, the hour this window ends. 24 means midnight at the end of the day."),
    end_minute: MinuteOfHourEnum.default("ZERO"),
    days: z.array(DayOfWeekEnum).min(1).default(ALL_DAYS).describe("Which days this window applies to. Defaults to every day — pass a subset for e.g. weekdays only."),
    customer_id: customerIdField,
    response_format: responseFormatField,
  })
  .strict()
  .refine((v) => v.end_hour > v.start_hour, {
    message: "end_hour must be after start_hour. For a window spanning midnight (e.g. 22:00-06:00), add it as two calls: one ending at 24:00 and one starting at 0:00.",
    path: ["end_hour"],
  });
export type AddCampaignAdScheduleInput = z.infer<typeof AddCampaignAdScheduleInputSchema>;

export const ListCampaignAdScheduleInputSchema = z
  .object({
    campaign_id: z.string().min(1),
    customer_id: customerIdField,
    response_format: responseFormatField,
  })
  .strict();
export type ListCampaignAdScheduleInput = z.infer<typeof ListCampaignAdScheduleInputSchema>;

export const RemoveCampaignAdScheduleInputSchema = z
  .object({
    campaign_id: z.string().min(1),
    criterion_id: z.string().min(1).describe("campaign_criterion.criterion_id, from google_ads_list_campaign_ad_schedule."),
    customer_id: customerIdField,
  })
  .strict();
export type RemoveCampaignAdScheduleInput = z.infer<typeof RemoveCampaignAdScheduleInputSchema>;
