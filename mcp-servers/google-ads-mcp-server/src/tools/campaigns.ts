import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CreateCampaignInput,
  CreateCampaignInputSchema,
  DeleteCampaignInput,
  DeleteCampaignInputSchema,
  GetCampaignInput,
  GetCampaignInputSchema,
  ListCampaignsInput,
  ListCampaignsInputSchema,
  UpdateCampaignInput,
  UpdateCampaignInputSchema,
} from "../schemas/campaigns.js";
import { ResponseFormat } from "../schemas/common.js";
import { handleGoogleAdsError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { buildUpdateOperation, mutate, resourceName, searchOne, searchPaged } from "../services/googleAdsClient.js";
import type { GaqlRow } from "../types.js";

const CAMPAIGN_FIELDS = [
  "campaign.id",
  "campaign.name",
  "campaign.status",
  "campaign.advertising_channel_type",
  "campaign.bidding_strategy_type",
  "campaign.start_date",
  "campaign.end_date",
  "campaign_budget.resource_name",
  "campaign_budget.amount_micros",
];

function renderCampaignMarkdown(row: GaqlRow): string {
  const c = row.campaign as Record<string, unknown>;
  const budget = row.campaignBudget as Record<string, unknown> | undefined;
  const dailyAmount = budget?.amountMicros ? `${Number(budget.amountMicros) / 1_000_000} / day` : "n/a";
  return [
    `## ${c.name} (\`${c.id}\`)`,
    `- **Status**: ${c.status}`,
    `- **Channel**: ${c.advertisingChannelType ?? "n/a"}`,
    `- **Bidding strategy**: ${c.biddingStrategyType ?? "n/a"}`,
    `- **Budget**: ${dailyAmount}`,
    `- **Dates**: ${c.startDate ?? "n/a"} to ${c.endDate ?? "no end date"}`,
  ].join("\n");
}

function biddingStrategyField(input: CreateCampaignInput): Record<string, unknown> {
  switch (input.bidding_strategy) {
    case "MANUAL_CPC":
      return { manualCpc: {} };
    case "TARGET_SPEND":
      return { targetSpend: {} };
    case "MAXIMIZE_CONVERSIONS":
      return { maximizeConversions: {} };
    case "MAXIMIZE_CONVERSION_VALUE":
      return { maximizeConversionValue: {} };
    case "TARGET_CPA":
      return { targetCpa: { targetCpaMicros: String(input.target_cpa_micros) } };
    case "TARGET_ROAS":
      return { targetRoas: { targetRoas: input.target_roas } };
  }
}

export function registerCampaignTools(server: McpServer): void {
  server.registerTool(
    "google_ads_list_campaigns",
    {
      title: "List Google Ads Campaigns",
      description: `List campaigns in the configured customer account (GOOGLE_ADS_CUSTOMER_ID), optionally filtered by status or name substring.

Read-only. Use google_ads_create_campaign to create one.

Args:
  - status_filter (string[], optional): statuses to include, e.g. ["ENABLED","PAUSED"]. Omit for all.
  - name_contains (string, optional): substring match on campaign name.
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor from a previous call's next_cursor
  - response_format ('markdown'|'json', default markdown)

Returns paginated campaigns with id, name, status, channel type, bidding strategy, and daily budget.

Error Handling:
  - "Permission denied" if the OAuth user doesn't have access to GOOGLE_ADS_CUSTOMER_ID
  - "OAuth access token rejected" if GOOGLE_ADS_REFRESH_TOKEN needs to be regenerated`,
      inputSchema: ListCampaignsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListCampaignsInput) => {
      try {
        const conditions: string[] = [];
        if (params.status_filter?.length) {
          conditions.push(`campaign.status IN (${params.status_filter.map((s) => `'${s}'`).join(",")})`);
        }
        if (params.name_contains) {
          conditions.push(`campaign.name LIKE '%${params.name_contains.replace(/'/g, "\\'")}%'`);
        }

        const query = `SELECT ${CAMPAIGN_FIELDS.join(", ")} FROM campaign${
          conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""
        } ORDER BY campaign.id`;

        const paged = await searchPaged(query, params.limit, params.after);

        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No campaigns found matching the given filters." }] };
        }

        const markdown = [`# Campaigns (${paged.count})`, "", ...paged.items.map(renderCampaignMarkdown)].join("\n\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_get_campaign",
    {
      title: "Get Google Ads Campaign",
      description: `Fetch full details for a single campaign by ID.

Args:
  - campaign_id (string): required
  - response_format ('markdown'|'json', default markdown)

Returns the campaign's id, name, status, channel type, bidding strategy, and budget.

Error Handling:
  - Returns "not found" style error if campaign_id doesn't exist or isn't visible to this account`,
      inputSchema: GetCampaignInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetCampaignInput) => {
      try {
        const query = `SELECT ${CAMPAIGN_FIELDS.join(", ")} FROM campaign WHERE campaign.id = ${Number(params.campaign_id)}`;
        const row = await searchOne(query);
        if (!row) return errorResponse(`Error: Campaign ${params.campaign_id} not found.`);
        return buildResponse(row, renderCampaignMarkdown(row), params.response_format);
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_create_campaign",
    {
      title: "Create Google Ads Campaign",
      description: `Create a new campaign (and its budget) in the configured customer account. Defaults to status=PAUSED so nothing spends until you explicitly enable it with google_ads_update_campaign.

Unlike other ad platforms, Google Ads always budgets at the campaign level — this tool creates a CampaignBudget resource for you from daily_budget_micros, there's no option to budget per ad group instead.

Args:
  - name (string): required
  - advertising_channel_type ('SEARCH'|'DISPLAY'|'SHOPPING'|'VIDEO'|'PERFORMANCE_MAX'|'DEMAND_GEN', default SEARCH): closest equivalent to an "objective"
  - status ('ENABLED'|'PAUSED', default PAUSED)
  - daily_budget_micros (number): required. Currency unit × 1,000,000 (e.g. 5000000 = 5.00)
  - shared_budget (boolean, default false)
  - budget_delivery_method ('STANDARD'|'ACCELERATED', default STANDARD)
  - bidding_strategy ('MANUAL_CPC'|'TARGET_SPEND'|'MAXIMIZE_CONVERSIONS'|'MAXIMIZE_CONVERSION_VALUE'|'TARGET_CPA'|'TARGET_ROAS', default MANUAL_CPC)
  - target_cpa_micros (number, optional): required when bidding_strategy is TARGET_CPA
  - target_roas (number, optional): required when bidding_strategy is TARGET_ROAS
  - start_date / end_date (string, optional): YYYY-MM-DD
  - response_format ('markdown'|'json', default markdown)

Returns the created campaign's id and the fields it was created with.

Don't use when: you want to change an existing campaign — use google_ads_update_campaign instead.

Error Handling:
  - "Invalid argument" if bidding_strategy requires target_cpa_micros/target_roas and it wasn't provided
  - "Permission denied" if conversion-tracking-dependent bidding strategies are rejected because no conversion actions exist yet`,
      inputSchema: CreateCampaignInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CreateCampaignInput) => {
      try {
        if (params.bidding_strategy === "TARGET_CPA" && !params.target_cpa_micros) {
          return errorResponse("Error: target_cpa_micros is required when bidding_strategy is TARGET_CPA.");
        }
        if (params.bidding_strategy === "TARGET_ROAS" && !params.target_roas) {
          return errorResponse("Error: target_roas is required when bidding_strategy is TARGET_ROAS.");
        }

        const [budgetResult] = await mutate("campaignBudgets", [
          {
            create: {
              name: `${params.name} Budget`,
              amountMicros: String(params.daily_budget_micros),
              deliveryMethod: params.budget_delivery_method,
              explicitlyShared: params.shared_budget,
            },
          },
        ]);

        const [campaignResult] = await mutate("campaigns", [
          {
            create: {
              name: params.name,
              status: params.status,
              advertisingChannelType: params.advertising_channel_type,
              campaignBudget: budgetResult.resourceName,
              ...biddingStrategyField(params),
              ...(params.start_date ? { startDate: params.start_date } : {}),
              ...(params.end_date ? { endDate: params.end_date } : {}),
              ...(params.advertising_channel_type === "SEARCH"
                ? {
                    networkSettings: {
                      targetGoogleSearch: true,
                      targetSearchNetwork: true,
                      targetContentNetwork: false,
                      targetPartnerSearch: false,
                    },
                  }
                : {}),
            },
          },
        ]);

        const campaignId = campaignResult.resourceName.split("/").pop()!;
        const payload = { id: campaignId, name: params.name, status: params.status, advertising_channel_type: params.advertising_channel_type };
        return buildResponse(
          payload,
          `Created campaign **${params.name}** (\`${campaignId}\`) — status: ${params.status}, channel: ${params.advertising_channel_type}`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_update_campaign",
    {
      title: "Update Google Ads Campaign",
      description: `Update an existing campaign's name, status, or daily budget. Only the fields you provide are changed.

Args:
  - campaign_id (string): required
  - name (string, optional)
  - status ('ENABLED'|'PAUSED'|'REMOVED', optional): use PAUSED to stop spend without removing the campaign
  - daily_budget_micros (number, optional): updates the campaign's existing budget resource
  - response_format ('markdown'|'json', default markdown)

Returns confirmation of the fields that were updated.

Don't use when: you want to permanently remove a campaign — use google_ads_delete_campaign (equivalent to status=REMOVED, which cannot be reversed via the API).`,
      inputSchema: UpdateCampaignInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: UpdateCampaignInput) => {
      try {
        const { campaign_id, response_format, daily_budget_micros, ...rest } = params;
        const campaignFields: Record<string, unknown> = {};
        if (rest.name !== undefined) campaignFields.name = rest.name;
        if (rest.status !== undefined) campaignFields.status = rest.status;

        if (Object.keys(campaignFields).length === 0 && daily_budget_micros === undefined) {
          return errorResponse("Error: Provide at least one field to update (name, status, or daily_budget_micros).");
        }

        const updated: Record<string, unknown> = {};
        if (Object.keys(campaignFields).length) {
          await mutate("campaigns", [buildUpdateOperation(resourceName("campaigns", campaign_id), campaignFields)]);
          Object.assign(updated, campaignFields);
        }

        if (daily_budget_micros !== undefined) {
          const row = await searchOne(`SELECT campaign_budget.resource_name FROM campaign WHERE campaign.id = ${Number(campaign_id)}`);
          const budgetResourceName = (row?.campaignBudget as Record<string, unknown> | undefined)?.resourceName as string | undefined;
          if (!budgetResourceName) return errorResponse(`Error: Campaign ${campaign_id} not found.`);
          await mutate("campaignBudgets", [buildUpdateOperation(budgetResourceName, { amountMicros: String(daily_budget_micros) })]);
          updated.daily_budget_micros = daily_budget_micros;
        }

        return buildResponse(
          { campaign_id, updated },
          `Updated campaign \`${campaign_id}\`: ${Object.entries(updated)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")}`,
          response_format
        );
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_delete_campaign",
    {
      title: "Delete Google Ads Campaign",
      description: `Permanently remove a campaign (cascades to its ad groups, ads, and keywords). This cannot be undone via the API.

Args:
  - campaign_id (string): required

Returns confirmation once the campaign is removed.

Don't use when: you just want to stop spend temporarily — use google_ads_update_campaign with status='PAUSED' instead.`,
      inputSchema: DeleteCampaignInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: DeleteCampaignInput) => {
      try {
        await mutate("campaigns", [{ remove: resourceName("campaigns", params.campaign_id) }]);
        return buildResponse(
          { campaign_id: params.campaign_id, removed: true },
          `Removed campaign \`${params.campaign_id}\`.`,
          ResponseFormat.MARKDOWN
        );
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );
}
