import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CreateAdInput,
  CreateAdInputSchema,
  DeleteAdInput,
  DeleteAdInputSchema,
  GetAdInput,
  GetAdInputSchema,
  ListAdsInput,
  ListAdsInputSchema,
  UpdateAdInput,
  UpdateAdInputSchema,
} from "../schemas/ads.js";
import { ResponseFormat } from "../schemas/common.js";
import { handleGraphApiError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { getAdAccountId, graphRequest, listPaged } from "../services/graphApiClient.js";
import type { Ad } from "../types.js";

const AD_FIELDS = "id,name,status,effective_status,adset_id,campaign_id,creative{id,name,thumbnail_url},created_time,updated_time";

function renderAdMarkdown(a: Ad): string {
  return [
    `## ${a.name} (\`${a.id}\`)`,
    `- **Status**: ${a.status}`,
    `- **Ad Set**: \`${a.adset_id ?? "n/a"}\``,
    `- **Creative**: \`${a.creative?.id ?? "n/a"}\``,
  ].join("\n");
}

export function registerAdTools(server: McpServer): void {
  server.registerTool(
    "meta_ads_list_ads",
    {
      title: "List Meta Ads Ads",
      description: `List ads in the configured ad account, optionally scoped to one ad set or campaign, or filtered by status.

Read-only.

Args:
  - adset_id (string, optional): only ads in this ad set (takes priority over campaign_id)
  - campaign_id (string, optional): only ads in this campaign
  - status_filter (string[], optional)
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor
  - response_format ('markdown'|'json', default markdown)

Returns paginated ads with id, name, status, adset_id, and the linked creative id/thumbnail.`,
      inputSchema: ListAdsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListAdsInput) => {
      try {
        const filtering: Array<Record<string, unknown>> = [];
        if (params.status_filter?.length) {
          filtering.push({ field: "effective_status", operator: "IN", value: params.status_filter });
        }
        const endpoint = params.adset_id
          ? `/${params.adset_id}/ads`
          : params.campaign_id
            ? `/${params.campaign_id}/ads`
            : `/${getAdAccountId()}/ads`;
        const paged = await listPaged<Ad>(
          endpoint,
          { fields: AD_FIELDS, ...(filtering.length ? { filtering: JSON.stringify(filtering) } : {}) },
          params.limit
        );

        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No ads found matching the given filters." }] };
        }

        const markdown = [`# Ads (${paged.count})`, "", ...paged.items.map(renderAdMarkdown)].join("\n\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_get_ad",
    {
      title: "Get Meta Ads Ad",
      description: `Fetch full details for a single ad by ID, including its linked creative.

Args:
  - ad_id (string): required
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: GetAdInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetAdInput) => {
      try {
        const ad = await graphRequest<Ad>(`/${params.ad_id}`, { params: { fields: AD_FIELDS } });
        return buildResponse(ad as unknown as Record<string, unknown>, renderAdMarkdown(ad), params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_create_ad",
    {
      title: "Create Meta Ads Ad",
      description: `Create a new ad by linking an ad set to an existing Ad Creative. Defaults to status=PAUSED.

Args:
  - name, adset_id, creative_id (string): required — build the creative first with meta_ads_create_ad_creative
  - status ('ACTIVE'|'PAUSED', default PAUSED)
  - response_format ('markdown'|'json', default markdown)

Returns the created ad's id.

Don't use when: you don't have a creative_id yet — call meta_ads_upload_image/meta_ads_upload_video then meta_ads_create_ad_creative first.`,
      inputSchema: CreateAdInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CreateAdInput) => {
      try {
        const created = await graphRequest<{ id: string }>(`/${getAdAccountId()}/ads`, {
          method: "POST",
          params: {
            name: params.name,
            adset_id: params.adset_id,
            creative: JSON.stringify({ creative_id: params.creative_id }),
            status: params.status,
          },
        });
        return buildResponse(
          { id: created.id, name: params.name, adset_id: params.adset_id, status: params.status },
          `Created ad **${params.name}** (\`${created.id}\`) in ad set \`${params.adset_id}\` — status: ${params.status}`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_update_ad",
    {
      title: "Update Meta Ads Ad",
      description: `Update an existing ad's name, status, or linked creative. Only the fields you provide are changed.

Args:
  - ad_id (string): required
  - name, status, creative_id: all optional
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: UpdateAdInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: UpdateAdInput) => {
      try {
        const { ad_id, response_format, creative_id, ...rest } = params;
        const updateFields: Record<string, string> = {};
        for (const [key, value] of Object.entries(rest)) {
          if (value !== undefined) updateFields[key] = String(value);
        }
        if (creative_id) {
          updateFields.creative = JSON.stringify({ creative_id });
        }
        if (Object.keys(updateFields).length === 0) {
          return errorResponse("Error: Provide at least one field to update (name, status, or creative_id).");
        }
        await graphRequest<{ success: boolean }>(`/${ad_id}`, { method: "POST", params: updateFields });
        return buildResponse({ ad_id, updated: Object.keys(updateFields) }, `Updated ad \`${ad_id}\`: ${Object.keys(updateFields).join(", ")}`, response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_delete_ad",
    {
      title: "Delete Meta Ads Ad",
      description: `Permanently delete an ad. This cannot be undone.

Args:
  - ad_id (string): required

Don't use when: you just want to pause it — use meta_ads_update_ad with status='PAUSED' instead.`,
      inputSchema: DeleteAdInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: DeleteAdInput) => {
      try {
        await graphRequest<{ success: boolean }>(`/${params.ad_id}`, { method: "DELETE" });
        return buildResponse({ ad_id: params.ad_id, deleted: true }, `Deleted ad \`${params.ad_id}\`.`, ResponseFormat.MARKDOWN);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );
}
