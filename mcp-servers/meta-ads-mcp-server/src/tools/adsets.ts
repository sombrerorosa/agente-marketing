import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildTargetingPayload,
  CreateAdSetInput,
  CreateAdSetInputSchema,
  DeleteAdSetInput,
  DeleteAdSetInputSchema,
  GetAdSetInput,
  GetAdSetInputSchema,
  ListAdSetsInput,
  ListAdSetsInputSchema,
  UpdateAdSetInput,
  UpdateAdSetInputSchema,
} from "../schemas/adsets.js";
import { ResponseFormat } from "../schemas/common.js";
import { handleGraphApiError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { getAdAccountId, graphRequest, listPaged } from "../services/graphApiClient.js";
import type { AdSet } from "../types.js";

const ADSET_FIELDS =
  "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_strategy,bid_amount,targeting,start_time,end_time";

function renderAdSetMarkdown(a: AdSet): string {
  const budget = a.daily_budget ? `${a.daily_budget} / day` : a.lifetime_budget ? `${a.lifetime_budget} lifetime` : "inherited from campaign (CBO)";
  return [
    `## ${a.name} (\`${a.id}\`)`,
    `- **Status**: ${a.status}`,
    `- **Campaign**: \`${a.campaign_id ?? "n/a"}\``,
    `- **Budget**: ${budget}`,
    `- **Optimization goal**: ${a.optimization_goal ?? "n/a"}`,
    `- **Billing event**: ${a.billing_event ?? "n/a"}`,
  ].join("\n");
}

export function registerAdSetTools(server: McpServer): void {
  server.registerTool(
    "meta_ads_list_adsets",
    {
      title: "List Meta Ads Ad Sets",
      description: `List ad sets in the configured ad account, optionally scoped to one campaign or filtered by status.

Read-only.

Args:
  - campaign_id (string, optional): only ad sets under this campaign
  - status_filter (string[], optional): effective statuses to include
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor
  - response_format ('markdown'|'json', default markdown)

Returns paginated ad sets with id, name, status, campaign_id, budget, optimization_goal, billing_event.`,
      inputSchema: ListAdSetsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListAdSetsInput) => {
      try {
        const filtering: Array<Record<string, unknown>> = [];
        if (params.status_filter?.length) {
          filtering.push({ field: "effective_status", operator: "IN", value: params.status_filter });
        }
        const endpoint = params.campaign_id ? `/${params.campaign_id}/adsets` : `/${getAdAccountId()}/adsets`;
        const paged = await listPaged<AdSet>(
          endpoint,
          { fields: ADSET_FIELDS, ...(filtering.length ? { filtering: JSON.stringify(filtering) } : {}) },
          params.limit
        );

        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No ad sets found matching the given filters." }] };
        }

        const markdown = [`# Ad Sets (${paged.count})`, "", ...paged.items.map(renderAdSetMarkdown)].join("\n\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_get_adset",
    {
      title: "Get Meta Ads Ad Set",
      description: `Fetch full details for a single ad set by ID, including its resolved targeting spec.

Args:
  - adset_id (string): required
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: GetAdSetInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetAdSetInput) => {
      try {
        const adset = await graphRequest<AdSet>(`/${params.adset_id}`, { params: { fields: ADSET_FIELDS } });
        return buildResponse(adset as unknown as Record<string, unknown>, renderAdSetMarkdown(adset), params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_create_adset",
    {
      title: "Create Meta Ads Ad Set",
      description: `Create a new ad set under an existing campaign, with budget, optimization goal, and audience targeting. Defaults to status=PAUSED.

Args:
  - name, campaign_id (string): required
  - status ('ACTIVE'|'PAUSED', default PAUSED)
  - daily_budget_cents / lifetime_budget_cents (number): required unless the campaign uses Campaign Budget Optimization
  - optimization_goal (string): required, e.g. LINK_CLICKS, OFFSITE_CONVERSIONS, THRUPLAY, REACH
  - billing_event (string): required, e.g. IMPRESSIONS, LINK_CLICKS
  - bid_strategy (string, default LOWEST_COST_WITHOUT_CAP)
  - bid_amount_cents (number, optional): required if bid_strategy is LOWEST_COST_WITH_BID_CAP or COST_CAP
  - targeting (object): required — countries, age_min/age_max, genders, interest_ids, custom_audience_ids, advantage_audience
  - promoted_object (object, optional): required when optimization_goal is OFFSITE_CONVERSIONS ({pixel_id, custom_event_type}) or APP_INSTALLS ({application_id, object_store_url})
  - start_time / end_time (string, optional): ISO 8601
  - response_format ('markdown'|'json', default markdown)

Returns the created ad set's id.

Error Handling:
  - "Invalid parameter" if promoted_object is missing for a conversions/app-install optimization_goal
  - "Invalid parameter" if bid_amount_cents is missing while bid_strategy requires one`,
      inputSchema: CreateAdSetInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CreateAdSetInput) => {
      try {
        if (params.daily_budget_cents && params.lifetime_budget_cents) {
          return errorResponse("Error: Provide only one of daily_budget_cents or lifetime_budget_cents, not both.");
        }
        if (params.bid_strategy !== "LOWEST_COST_WITHOUT_CAP" && !params.bid_amount_cents) {
          return errorResponse(`Error: bid_amount_cents is required when bid_strategy is '${params.bid_strategy}'.`);
        }

        const created = await graphRequest<{ id: string }>(`/${getAdAccountId()}/adsets`, {
          method: "POST",
          params: {
            name: params.name,
            campaign_id: params.campaign_id,
            status: params.status,
            optimization_goal: params.optimization_goal,
            billing_event: params.billing_event,
            bid_strategy: params.bid_strategy,
            targeting: JSON.stringify(buildTargetingPayload(params.targeting)),
            ...(params.daily_budget_cents ? { daily_budget: String(params.daily_budget_cents) } : {}),
            ...(params.lifetime_budget_cents ? { lifetime_budget: String(params.lifetime_budget_cents) } : {}),
            ...(params.bid_amount_cents ? { bid_amount: String(params.bid_amount_cents) } : {}),
            ...(params.start_time ? { start_time: params.start_time } : {}),
            ...(params.end_time ? { end_time: params.end_time } : {}),
            ...(params.promoted_object ? { promoted_object: JSON.stringify(params.promoted_object) } : {}),
          },
        });
        return buildResponse(
          { id: created.id, name: params.name, campaign_id: params.campaign_id, status: params.status },
          `Created ad set **${params.name}** (\`${created.id}\`) under campaign \`${params.campaign_id}\` — status: ${params.status}`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_update_adset",
    {
      title: "Update Meta Ads Ad Set",
      description: `Update an existing ad set's name, status, budget, bid, or targeting. Only the fields you provide are changed.

Args:
  - adset_id (string): required
  - name, status, daily_budget_cents, lifetime_budget_cents, bid_amount_cents, targeting: all optional
  - response_format ('markdown'|'json', default markdown)

Returns confirmation of the fields that were updated.`,
      inputSchema: UpdateAdSetInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: UpdateAdSetInput) => {
      try {
        const { adset_id, response_format, targeting, ...rest } = params;
        const updateFields: Record<string, string> = {};
        for (const [key, value] of Object.entries(rest)) {
          if (value === undefined) continue;
          const apiKey = key === "daily_budget_cents" ? "daily_budget" : key === "lifetime_budget_cents" ? "lifetime_budget" : key === "bid_amount_cents" ? "bid_amount" : key;
          updateFields[apiKey] = typeof value === "number" ? String(value) : String(value);
        }
        if (targeting) {
          updateFields.targeting = JSON.stringify(buildTargetingPayload(targeting));
        }
        if (Object.keys(updateFields).length === 0) {
          return errorResponse("Error: Provide at least one field to update.");
        }
        await graphRequest<{ success: boolean }>(`/${adset_id}`, { method: "POST", params: updateFields });
        return buildResponse(
          { adset_id, updated: Object.keys(updateFields) },
          `Updated ad set \`${adset_id}\`: ${Object.keys(updateFields).join(", ")}`,
          response_format
        );
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_delete_adset",
    {
      title: "Delete Meta Ads Ad Set",
      description: `Permanently delete an ad set (and cascades to its ads). This cannot be undone.

Args:
  - adset_id (string): required

Don't use when: you just want to pause spend — use meta_ads_update_adset with status='PAUSED' instead.`,
      inputSchema: DeleteAdSetInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: DeleteAdSetInput) => {
      try {
        await graphRequest<{ success: boolean }>(`/${params.adset_id}`, { method: "DELETE" });
        return buildResponse({ adset_id: params.adset_id, deleted: true }, `Deleted ad set \`${params.adset_id}\`.`, ResponseFormat.MARKDOWN);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );
}
