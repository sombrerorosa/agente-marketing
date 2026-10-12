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
import { handleGoogleAdsError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { mutate, resourceName, searchOne, searchPaged } from "../services/googleAdsClient.js";
import type { GaqlRow } from "../types.js";

const AD_FIELDS = [
  "ad_group_ad.status",
  "ad_group_ad.ad.id",
  "ad_group_ad.ad.final_urls",
  "ad_group_ad.ad.responsive_search_ad.headlines",
  "ad_group_ad.ad.responsive_search_ad.descriptions",
  "ad_group_ad.ad.responsive_search_ad.path1",
  "ad_group_ad.ad.responsive_search_ad.path2",
  "ad_group.id",
  "ad_group.name",
];

interface TextAsset {
  text: string;
  pinnedField?: string;
}

function renderAdMarkdown(row: GaqlRow): string {
  const adGroupAd = row.adGroupAd as Record<string, unknown>;
  const ad = adGroupAd.ad as Record<string, unknown>;
  const rsa = (ad.responsiveSearchAd ?? {}) as Record<string, unknown>;
  const headlines = ((rsa.headlines ?? []) as TextAsset[]).map((h) => h.text).join(" | ");
  const descriptions = ((rsa.descriptions ?? []) as TextAsset[]).map((d) => d.text).join(" | ");
  return [
    `## Ad \`${ad.id}\``,
    `- **Status**: ${adGroupAd.status}`,
    `- **Final URLs**: ${(ad.finalUrls as string[] | undefined)?.join(", ") ?? "n/a"}`,
    `- **Headlines**: ${headlines || "n/a"}`,
    `- **Descriptions**: ${descriptions || "n/a"}`,
  ].join("\n");
}

export function registerAdTools(server: McpServer): void {
  server.registerTool(
    "google_ads_list_ads",
    {
      title: "List Google Ads Ads",
      description: `List ads, optionally filtered by ad group or campaign.

Read-only. Only Responsive Search Ads are supported by google_ads_create_ad right now — this lists whatever ad types exist on the account, but other types will show with empty headline/description fields.

Args:
  - ad_group_id (string, optional): filter to ads in this ad group
  - campaign_id (string, optional): filter to ads in this campaign (ignored if ad_group_id is set)
  - status_filter (string[], optional): e.g. ["ENABLED","PAUSED"]
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: ListAdsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListAdsInput) => {
      try {
        const conditions: string[] = [];
        if (params.ad_group_id) conditions.push(`ad_group.id = ${Number(params.ad_group_id)}`);
        else if (params.campaign_id) conditions.push(`campaign.id = ${Number(params.campaign_id)}`);
        if (params.status_filter?.length) {
          conditions.push(`ad_group_ad.status IN (${params.status_filter.map((s) => `'${s}'`).join(",")})`);
        }

        const fields = params.ad_group_id || !params.campaign_id ? AD_FIELDS : [...AD_FIELDS, "campaign.id"];
        const query = `SELECT ${fields.join(", ")} FROM ad_group_ad${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY ad_group_ad.ad.id`;

        const paged = await searchPaged(query, params.limit, params.after, params.customer_id);
        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No ads found matching the given filters." }] };
        }

        const markdown = [`# Ads (${paged.count})`, "", ...paged.items.map(renderAdMarkdown)].join("\n\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_get_ad",
    {
      title: "Get Google Ads Ad",
      description: `Fetch full details for a single ad. Google's ad resource name is composite (ad group + ad id) — unlike a flat ad id, both are required.

Args:
  - ad_group_id (string): required
  - ad_id (string): required
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: GetAdInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetAdInput) => {
      try {
        const query = `SELECT ${AD_FIELDS.join(", ")} FROM ad_group_ad WHERE ad_group.id = ${Number(params.ad_group_id)} AND ad_group_ad.ad.id = ${Number(params.ad_id)}`;
        const row = await searchOne(query, params.customer_id);
        if (!row) return errorResponse(`Error: Ad ${params.ad_id} not found in ad group ${params.ad_group_id}.`);
        return buildResponse(row, renderAdMarkdown(row), params.response_format);
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_create_ad",
    {
      title: "Create Google Ads Responsive Search Ad",
      description: `Create a Responsive Search Ad in an ad group — the default ad type for Search campaigns, where Google rotates and combines the headlines/descriptions you provide. This is the only ad type this tool creates; other formats (Display, Performance Max, video) need their asset groups built in the Ads Manager UI for now.

Args:
  - ad_group_id (string): required
  - final_urls (string[]): required, at least 1 landing page URL
  - headlines (array): 3-15 entries, each { text (≤30 chars), pinned_position? }
  - descriptions (array): 2-4 entries, each { text (≤90 chars), pinned_position? }
  - path1 / path2 (string, optional): display-URL path segments, ≤15 chars each
  - status ('ENABLED'|'PAUSED', default PAUSED)
  - response_format ('markdown'|'json', default markdown)

Returns the created ad's id.

Don't use when: you want to edit an existing ad's copy — headlines/descriptions are immutable once created; remove the ad and create a new one instead.

Error Handling:
  - "Invalid argument" if final_urls' domain isn't verified for the account, or headline/description text trips Google's ad policy checks`,
      inputSchema: CreateAdInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CreateAdInput) => {
      try {
        if (params.path2 && !params.path1) {
          return errorResponse("Error: path2 requires path1 to also be set.");
        }

        const [result] = await mutate(
          "adGroupAds",
          [
          {
            create: {
              adGroup: resourceName("adGroups", params.ad_group_id, params.customer_id),
              status: params.status,
              ad: {
                finalUrls: params.final_urls,
                responsiveSearchAd: {
                  headlines: params.headlines.map((h) => ({
                    text: h.text,
                    ...(h.pinned_position ? { pinnedField: h.pinned_position } : {}),
                  })),
                  descriptions: params.descriptions.map((d) => ({
                    text: d.text,
                    ...(d.pinned_position ? { pinnedField: d.pinned_position } : {}),
                  })),
                  ...(params.path1 ? { path1: params.path1 } : {}),
                  ...(params.path2 ? { path2: params.path2 } : {}),
                },
              },
            },
          },
          ],
          params.customer_id
        );

        const adId = result.resourceName.split("~").pop()!;
        return buildResponse(
          { ad_group_id: params.ad_group_id, ad_id: adId, status: params.status },
          `Created responsive search ad \`${adId}\` in ad group \`${params.ad_group_id}\` — status: ${params.status}`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_update_ad",
    {
      title: "Update Google Ads Ad Status",
      description: `Change an existing ad's status. Headline/description/URL content is immutable once created — to change ad copy, remove the ad and create a new one.

Args:
  - ad_group_id (string): required
  - ad_id (string): required
  - status ('ENABLED'|'PAUSED'|'REMOVED'): required
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: UpdateAdInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: UpdateAdInput) => {
      try {
        await mutate(
          "adGroupAds",
          [
            {
              update: {
                resourceName: resourceName("adGroupAds", `${params.ad_group_id}~${params.ad_id}`, params.customer_id),
                status: params.status,
              },
              updateMask: "status",
            },
          ],
          params.customer_id
        );
        return buildResponse(
          { ad_group_id: params.ad_group_id, ad_id: params.ad_id, status: params.status },
          `Updated ad \`${params.ad_id}\`: status=${params.status}`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_delete_ad",
    {
      title: "Delete Google Ads Ad",
      description: `Permanently remove an ad. This cannot be undone via the API.

Args:
  - ad_group_id (string): required
  - ad_id (string): required

Don't use when: you just want to stop it running temporarily — use google_ads_update_ad with status='PAUSED' instead.`,
      inputSchema: DeleteAdInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: DeleteAdInput) => {
      try {
        await mutate(
          "adGroupAds",
          [{ remove: resourceName("adGroupAds", `${params.ad_group_id}~${params.ad_id}`, params.customer_id) }],
          params.customer_id
        );
        return buildResponse(
          { ad_group_id: params.ad_group_id, ad_id: params.ad_id, removed: true },
          `Removed ad \`${params.ad_id}\` from ad group \`${params.ad_group_id}\`.`,
          ResponseFormat.MARKDOWN
        );
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );
}
