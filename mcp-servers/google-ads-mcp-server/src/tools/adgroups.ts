import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CreateAdGroupInput,
  CreateAdGroupInputSchema,
  DeleteAdGroupInput,
  DeleteAdGroupInputSchema,
  GetAdGroupInput,
  GetAdGroupInputSchema,
  ListAdGroupsInput,
  ListAdGroupsInputSchema,
  UpdateAdGroupInput,
  UpdateAdGroupInputSchema,
} from "../schemas/adgroups.js";
import { ResponseFormat } from "../schemas/common.js";
import { handleGoogleAdsError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { buildUpdateOperation, mutate, resourceName, searchOne, searchPaged } from "../services/googleAdsClient.js";
import type { GaqlRow } from "../types.js";

const AD_GROUP_FIELDS = [
  "ad_group.id",
  "ad_group.name",
  "ad_group.status",
  "ad_group.type",
  "ad_group.campaign",
  "ad_group.cpc_bid_micros",
  "campaign.id",
  "campaign.name",
];

function renderAdGroupMarkdown(row: GaqlRow): string {
  const ag = row.adGroup as Record<string, unknown>;
  const campaign = row.campaign as Record<string, unknown> | undefined;
  const bid = ag.cpcBidMicros ? `${Number(ag.cpcBidMicros) / 1_000_000}` : "n/a (inherits campaign bidding strategy)";
  return [
    `## ${ag.name} (\`${ag.id}\`)`,
    `- **Status**: ${ag.status}`,
    `- **Type**: ${ag.type ?? "n/a"}`,
    `- **Campaign**: ${campaign?.name ?? "n/a"} (\`${campaign?.id ?? "n/a"}\`)`,
    `- **CPC bid**: ${bid}`,
  ].join("\n");
}

export function registerAdGroupTools(server: McpServer): void {
  server.registerTool(
    "google_ads_list_ad_groups",
    {
      title: "List Google Ads Ad Groups",
      description: `List ad groups in the configured customer account, optionally filtered by campaign or status.

Read-only. Use google_ads_create_ad_group to create one.

Args:
  - campaign_id (string, optional): filter to ad groups in this campaign
  - status_filter (string[], optional): e.g. ["ENABLED","PAUSED"]
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor
  - response_format ('markdown'|'json', default markdown)

Returns paginated ad groups with id, name, status, type, parent campaign, and CPC bid.`,
      inputSchema: ListAdGroupsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListAdGroupsInput) => {
      try {
        const conditions: string[] = [];
        if (params.campaign_id) conditions.push(`campaign.id = ${Number(params.campaign_id)}`);
        if (params.status_filter?.length) {
          conditions.push(`ad_group.status IN (${params.status_filter.map((s) => `'${s}'`).join(",")})`);
        }

        const query = `SELECT ${AD_GROUP_FIELDS.join(", ")} FROM ad_group${
          conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""
        } ORDER BY ad_group.id`;

        const paged = await searchPaged(query, params.limit, params.after);
        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No ad groups found matching the given filters." }] };
        }

        const markdown = [`# Ad Groups (${paged.count})`, "", ...paged.items.map(renderAdGroupMarkdown)].join("\n\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_get_ad_group",
    {
      title: "Get Google Ads Ad Group",
      description: `Fetch full details for a single ad group by ID.

Args:
  - ad_group_id (string): required
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: GetAdGroupInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetAdGroupInput) => {
      try {
        const row = await searchOne(`SELECT ${AD_GROUP_FIELDS.join(", ")} FROM ad_group WHERE ad_group.id = ${Number(params.ad_group_id)}`);
        if (!row) return errorResponse(`Error: Ad group ${params.ad_group_id} not found.`);
        return buildResponse(row, renderAdGroupMarkdown(row), params.response_format);
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_create_ad_group",
    {
      title: "Create Google Ads Ad Group",
      description: `Create a new ad group inside an existing campaign. Defaults to status=PAUSED. Targeting (keywords, audiences) is added afterward with google_ads_add_keywords / the audience tools — unlike other ad platforms, Google Ads doesn't take targeting inline on the ad group itself.

Args:
  - name (string): required
  - campaign_id (string): required
  - status ('ENABLED'|'PAUSED', default PAUSED)
  - type ('SEARCH_STANDARD'|'DISPLAY_STANDARD'|'VIDEO_TRUE_VIEW_IN_STREAM'|'SHOPPING_PRODUCT_ADS', default SEARCH_STANDARD)
  - cpc_bid_micros (number, optional): only meaningful if the parent campaign uses MANUAL_CPC bidding
  - response_format ('markdown'|'json', default markdown)

Returns the created ad group's id.

Don't use when: you want to change an existing ad group — use google_ads_update_ad_group instead.`,
      inputSchema: CreateAdGroupInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CreateAdGroupInput) => {
      try {
        const [result] = await mutate("adGroups", [
          {
            create: {
              name: params.name,
              campaign: resourceName("campaigns", params.campaign_id),
              status: params.status,
              type: params.type,
              ...(params.cpc_bid_micros ? { cpcBidMicros: String(params.cpc_bid_micros) } : {}),
            },
          },
        ]);
        const adGroupId = result.resourceName.split("/").pop()!;
        return buildResponse(
          { id: adGroupId, name: params.name, campaign_id: params.campaign_id, status: params.status },
          `Created ad group **${params.name}** (\`${adGroupId}\`) in campaign \`${params.campaign_id}\` — status: ${params.status}`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_update_ad_group",
    {
      title: "Update Google Ads Ad Group",
      description: `Update an existing ad group's name, status, or CPC bid. Only the fields you provide are changed.

Args:
  - ad_group_id (string): required
  - name (string, optional)
  - status ('ENABLED'|'PAUSED'|'REMOVED', optional)
  - cpc_bid_micros (number, optional)
  - response_format ('markdown'|'json', default markdown)

Don't use when: you want to permanently remove an ad group — use google_ads_delete_ad_group.`,
      inputSchema: UpdateAdGroupInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: UpdateAdGroupInput) => {
      try {
        const { ad_group_id, response_format, ...fields } = params;
        const updateFields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        const updateFieldsApi: Record<string, unknown> = {};
        if (updateFields.name !== undefined) updateFieldsApi.name = updateFields.name;
        if (updateFields.status !== undefined) updateFieldsApi.status = updateFields.status;
        if (updateFields.cpc_bid_micros !== undefined) updateFieldsApi.cpcBidMicros = String(updateFields.cpc_bid_micros);

        if (Object.keys(updateFieldsApi).length === 0) {
          return errorResponse("Error: Provide at least one field to update (name, status, or cpc_bid_micros).");
        }

        await mutate("adGroups", [buildUpdateOperation(resourceName("adGroups", ad_group_id), updateFieldsApi)]);
        return buildResponse(
          { ad_group_id, updated: updateFields },
          `Updated ad group \`${ad_group_id}\`: ${Object.entries(updateFields)
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
    "google_ads_delete_ad_group",
    {
      title: "Delete Google Ads Ad Group",
      description: `Permanently remove an ad group (cascades to its ads and keywords). This cannot be undone via the API.

Args:
  - ad_group_id (string): required

Don't use when: you just want to stop spend temporarily — use google_ads_update_ad_group with status='PAUSED' instead.`,
      inputSchema: DeleteAdGroupInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: DeleteAdGroupInput) => {
      try {
        await mutate("adGroups", [{ remove: resourceName("adGroups", params.ad_group_id) }]);
        return buildResponse(
          { ad_group_id: params.ad_group_id, removed: true },
          `Removed ad group \`${params.ad_group_id}\`.`,
          ResponseFormat.MARKDOWN
        );
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );
}
