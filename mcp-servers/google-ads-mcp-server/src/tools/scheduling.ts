import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AddCampaignAdScheduleInput,
  AddCampaignAdScheduleInputSchema,
  ListCampaignAdScheduleInput,
  ListCampaignAdScheduleInputSchema,
  RemoveCampaignAdScheduleInput,
  RemoveCampaignAdScheduleInputSchema,
} from "../schemas/scheduling.js";
import { ResponseFormat } from "../schemas/common.js";
import { handleGoogleAdsError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { mutate, resourceName, searchPaged } from "../services/googleAdsClient.js";
import type { GaqlRow } from "../types.js";

const AD_SCHEDULE_FIELDS = [
  "campaign_criterion.criterion_id",
  "campaign_criterion.negative",
  "campaign_criterion.ad_schedule.day_of_week",
  "campaign_criterion.ad_schedule.start_hour",
  "campaign_criterion.ad_schedule.start_minute",
  "campaign_criterion.ad_schedule.end_hour",
  "campaign_criterion.ad_schedule.end_minute",
];

function formatHM(hour: unknown, minute: unknown): string {
  const minuteMap: Record<string, string> = { ZERO: "00", FIFTEEN: "15", THIRTY: "30", FORTY_FIVE: "45" };
  return `${String(hour).padStart(2, "0")}:${minuteMap[String(minute)] ?? "00"}`;
}

function renderScheduleMarkdown(row: GaqlRow): string {
  const c = row.campaignCriterion as Record<string, unknown>;
  const sched = c.adSchedule as Record<string, unknown>;
  const window = `${formatHM(sched.startHour, sched.startMinute)}-${formatHM(sched.endHour, sched.endMinute)}`;
  return `- \`${c.criterionId}\` **${sched.dayOfWeek}** ${window} _(campaign runs ONLY during this window, and any other ad-schedule window on this campaign)_`;
}

export function registerSchedulingTools(server: McpServer): void {
  server.registerTool(
    "google_ads_add_campaign_ad_schedule",
    {
      title: "Add Google Ads Campaign Ad Schedule",
      description: `Add a dayparting (ad schedule) rule to a campaign — once any ad schedule criterion exists on a campaign, it ONLY serves during the window(s) you've added (and nowhere else), every other hour becomes excluded automatically. Creates one CampaignCriterion per day in \`days\`.

Google's ad schedule criteria are inclusion-only — there's no "negative ad schedule" to mark one window as excluded while leaving the rest of the day unrestricted (the API rejects negative=true on this criterion type outright). So to turn a campaign OFF for a block of time, add the window(s) covering the REST of the day instead: to go dark from 00:00-06:00, add one window from 06:00-24:00; to go dark from 12:00-14:00, add two windows, 00:00-12:00 and 14:00-24:00.

Args:
  - campaign_id (string): required
  - start_hour (number, 0-23): required
  - start_minute ('ZERO'|'FIFTEEN'|'THIRTY'|'FORTY_FIVE', default ZERO)
  - end_hour (number, 0-24): required. 24 = midnight at the end of the day.
  - end_minute ('ZERO'|'FIFTEEN'|'THIRTY'|'FORTY_FIVE', default ZERO)
  - days (string[], default all 7 days): subset of MONDAY..SUNDAY
  - response_format ('markdown'|'json', default markdown)

Returns the created criterion ids, one per day.

Don't use when: the window spans midnight (e.g. wanting to serve 22:00-06:00) — split it into two calls (22:00-24:00 and 00:00-06:00) instead, since end_hour must be greater than start_hour.

Error Handling:
  - "Invalid argument" if this exact day/window already has a criterion on this campaign`,
      inputSchema: AddCampaignAdScheduleInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: AddCampaignAdScheduleInput) => {
      try {
        const operations = params.days.map((day) => ({
          create: {
            campaign: resourceName("campaigns", params.campaign_id, params.customer_id),
            adSchedule: {
              dayOfWeek: day,
              startHour: params.start_hour,
              startMinute: params.start_minute,
              endHour: params.end_hour,
              endMinute: params.end_minute,
            },
          },
        }));
        const results = await mutate("campaignCriteria", operations, params.customer_id);
        const ids = results.map((r) => r.resourceName.split("~").pop());
        const window = `${formatHM(params.start_hour, params.start_minute)}-${formatHM(params.end_hour, params.end_minute)}`;
        return buildResponse(
          { campaign_id: params.campaign_id, criterion_ids: ids, days: params.days, window },
          `Campaign \`${params.campaign_id}\` now runs only ${window} on ${params.days.join(", ")} (criteria: ${ids.join(", ")}).`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_list_campaign_ad_schedule",
    {
      title: "List Google Ads Campaign Ad Schedule",
      description: `List dayparting (ad schedule) rules on a campaign.

Read-only.

Args:
  - campaign_id (string): required
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: ListCampaignAdScheduleInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListCampaignAdScheduleInput) => {
      try {
        const query = `SELECT ${AD_SCHEDULE_FIELDS.join(", ")} FROM campaign_criterion WHERE campaign.id = ${Number(params.campaign_id)} AND campaign_criterion.type = 'AD_SCHEDULE' ORDER BY campaign_criterion.criterion_id`;
        const paged = await searchPaged(query, 100, undefined, params.customer_id);
        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No ad schedule rules on this campaign — it serves all hours, every day." }] };
        }
        const markdown = [`# Ad Schedule — Campaign \`${params.campaign_id}\` (${paged.count})`, "", ...paged.items.map(renderScheduleMarkdown)].join("\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_remove_campaign_ad_schedule",
    {
      title: "Remove Google Ads Campaign Ad Schedule",
      description: `Remove one ad schedule rule from a campaign.

Args:
  - campaign_id (string): required
  - criterion_id (string): required, from google_ads_list_campaign_ad_schedule`,
      inputSchema: RemoveCampaignAdScheduleInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: RemoveCampaignAdScheduleInput) => {
      try {
        await mutate(
          "campaignCriteria",
          [{ remove: resourceName("campaignCriteria", `${params.campaign_id}~${params.criterion_id}`, params.customer_id) }],
          params.customer_id
        );
        return buildResponse(
          { campaign_id: params.campaign_id, criterion_id: params.criterion_id, removed: true },
          `Removed ad schedule criterion \`${params.criterion_id}\` from campaign \`${params.campaign_id}\`.`,
          ResponseFormat.MARKDOWN
        );
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );
}
