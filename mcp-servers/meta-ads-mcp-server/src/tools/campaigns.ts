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
import { handleGraphApiError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { getAdAccountId, graphRequest, listPaged } from "../services/graphApiClient.js";
import type { Campaign } from "../types.js";

const CAMPAIGN_FIELDS =
  "id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time";

function renderCampaignMarkdown(c: Campaign): string {
  const budget = c.daily_budget
    ? `${c.daily_budget} / day`
    : c.lifetime_budget
      ? `${c.lifetime_budget} lifetime`
      : "not set at campaign level (likely set per ad set)";
  return [
    `## ${c.name} (\`${c.id}\`)`,
    `- **Status**: ${c.status}`,
    `- **Objective**: ${c.objective ?? "n/a"}`,
    `- **Budget**: ${budget}`,
    `- **Created**: ${c.created_time ?? "n/a"}`,
  ].join("\n");
}

export function registerCampaignTools(server: McpServer): void {
  server.registerTool(
    "meta_ads_list_campaigns",
    {
      title: "List Meta Ads Campaigns",
      description: `List campaigns in the configured ad account (META_AD_ACCOUNT_ID), optionally filtered by status or name substring.

Read-only. Use meta_ads_create_campaign to create one.

Args:
  - status_filter (string[], optional): effective statuses to include, e.g. ["ACTIVE","PAUSED"]. Omit for all.
  - name_contains (string, optional): case-insensitive substring match on campaign name.
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor from a previous call's next_cursor
  - response_format ('markdown'|'json', default markdown)

Returns paginated campaigns with id, name, status, objective, and budget.

Error Handling:
  - "Permission denied" if the System User lacks ads_management/ads_read or the ad account isn't assigned to it
  - "invalid or expired" if META_ACCESS_TOKEN needs to be regenerated`,
      inputSchema: ListCampaignsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListCampaignsInput) => {
      try {
        const filtering: Array<Record<string, unknown>> = [];
        if (params.status_filter?.length) {
          filtering.push({ field: "effective_status", operator: "IN", value: params.status_filter });
        }
        if (params.name_contains) {
          filtering.push({ field: "name", operator: "CONTAIN", value: params.name_contains });
        }

        const paged = await listPaged<Campaign>(
          `/${getAdAccountId()}/campaigns`,
          {
            fields: CAMPAIGN_FIELDS,
            ...(filtering.length ? { filtering: JSON.stringify(filtering) } : {}),
          },
          params.limit
        );

        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No campaigns found matching the given filters." }] };
        }

        const markdown = [`# Campaigns (${paged.count})`, "", ...paged.items.map(renderCampaignMarkdown)].join("\n\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_get_campaign",
    {
      title: "Get Meta Ads Campaign",
      description: `Fetch full details for a single campaign by ID.

Args:
  - campaign_id (string): required
  - response_format ('markdown'|'json', default markdown)

Returns the campaign's id, name, status, objective, budget, and timestamps.

Error Handling:
  - "Resource not found" style error if campaign_id doesn't exist or isn't visible to this token`,
      inputSchema: GetCampaignInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetCampaignInput) => {
      try {
        const campaign = await graphRequest<Campaign>(`/${params.campaign_id}`, {
          params: { fields: CAMPAIGN_FIELDS },
        });
        return buildResponse(campaign as unknown as Record<string, unknown>, renderCampaignMarkdown(campaign), params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_create_campaign",
    {
      title: "Create Meta Ads Campaign",
      description: `Create a new campaign in the configured ad account. Defaults to status=PAUSED so nothing spends until you explicitly activate it with meta_ads_update_campaign.

Args:
  - name (string): required
  - objective (string): required, e.g. OUTCOME_TRAFFIC, OUTCOME_SALES, OUTCOME_LEADS, OUTCOME_ENGAGEMENT, OUTCOME_AWARENESS, OUTCOME_APP_PROMOTION
  - status ('ACTIVE'|'PAUSED', default PAUSED)
  - daily_budget_cents / lifetime_budget_cents (number, optional): campaign-level budget in minor currency unit (e.g. cents for USD). Omit both to set budgets per ad set instead.
  - buying_type ('AUCTION'|'RESERVED', default AUCTION)
  - special_ad_categories (string[], default ["NONE"]): must reflect HOUSING/EMPLOYMENT/CREDIT/ISSUES_ELECTIONS_POLITICS if applicable — Meta restricts targeting for these.
  - response_format ('markdown'|'json', default markdown)

Returns the created campaign's id and the fields it was created with.

Don't use when: you want to change an existing campaign — use meta_ads_update_campaign instead.

Error Handling:
  - "Invalid parameter" if objective/special_ad_categories combination is rejected by Meta's policy engine`,
      inputSchema: CreateCampaignInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CreateCampaignInput) => {
      try {
        if (params.daily_budget_cents && params.lifetime_budget_cents) {
          return errorResponse("Error: Provide only one of daily_budget_cents or lifetime_budget_cents, not both.");
        }
        const created = await graphRequest<{ id: string }>(`/${getAdAccountId()}/campaigns`, {
          method: "POST",
          params: {
            name: params.name,
            objective: params.objective,
            status: params.status,
            buying_type: params.buying_type,
            special_ad_categories: JSON.stringify(params.special_ad_categories),
            ...(params.daily_budget_cents ? { daily_budget: String(params.daily_budget_cents) } : {}),
            ...(params.lifetime_budget_cents ? { lifetime_budget: String(params.lifetime_budget_cents) } : {}),
          },
        });
        const payload = { id: created.id, name: params.name, objective: params.objective, status: params.status };
        return buildResponse(
          payload,
          `Created campaign **${params.name}** (\`${created.id}\`) — status: ${params.status}, objective: ${params.objective}`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_update_campaign",
    {
      title: "Update Meta Ads Campaign",
      description: `Update an existing campaign's name, status, or budget. Only the fields you provide are changed.

Args:
  - campaign_id (string): required
  - name (string, optional)
  - status ('ACTIVE'|'PAUSED'|'DELETED'|'ARCHIVED', optional): use PAUSED to stop spend without deleting the campaign
  - daily_budget_cents / lifetime_budget_cents (number, optional)
  - response_format ('markdown'|'json', default markdown)

Returns confirmation of the fields that were updated.

Don't use when: you want to permanently remove a campaign — use meta_ads_delete_campaign (status=DELETED is reversible via the API but hides it from the default UI view; DELETED via this tool vs meta_ads_delete_campaign are equivalent).`,
      inputSchema: UpdateCampaignInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: UpdateCampaignInput) => {
      try {
        const { campaign_id, response_format, ...fields } = params;
        const updateFields = Object.fromEntries(
          Object.entries(fields)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [
              k === "daily_budget_cents" ? "daily_budget" : k === "lifetime_budget_cents" ? "lifetime_budget" : k,
              typeof v === "number" ? String(v) : v,
            ])
        );
        if (Object.keys(updateFields).length === 0) {
          return errorResponse("Error: Provide at least one field to update (name, status, daily_budget_cents, or lifetime_budget_cents).");
        }
        await graphRequest<{ success: boolean }>(`/${campaign_id}`, { method: "POST", params: updateFields });
        return buildResponse(
          { campaign_id, updated: updateFields },
          `Updated campaign \`${campaign_id}\`: ${Object.entries(updateFields)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")}`,
          response_format
        );
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_delete_campaign",
    {
      title: "Delete Meta Ads Campaign",
      description: `Permanently delete a campaign (and cascades to its ad sets and ads). This cannot be undone.

Args:
  - campaign_id (string): required

Returns confirmation once the campaign is deleted.

Don't use when: you just want to stop spend temporarily — use meta_ads_update_campaign with status='PAUSED' instead.`,
      inputSchema: DeleteCampaignInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: DeleteCampaignInput) => {
      try {
        await graphRequest<{ success: boolean }>(`/${params.campaign_id}`, { method: "DELETE" });
        return buildResponse(
          { campaign_id: params.campaign_id, deleted: true },
          `Deleted campaign \`${params.campaign_id}\`.`,
          ResponseFormat.MARKDOWN
        );
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );
}
