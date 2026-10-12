import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AddCampaignNegativeKeywordsInput,
  AddCampaignNegativeKeywordsInputSchema,
  AddKeywordsInput,
  AddKeywordsInputSchema,
  ListKeywordsInput,
  ListKeywordsInputSchema,
  RemoveKeywordInput,
  RemoveKeywordInputSchema,
} from "../schemas/keywords.js";
import { ResponseFormat } from "../schemas/common.js";
import { handleGoogleAdsError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { mutate, resourceName, searchPaged } from "../services/googleAdsClient.js";
import type { GaqlRow } from "../types.js";

const KEYWORD_FIELDS = [
  "ad_group_criterion.criterion_id",
  "ad_group_criterion.status",
  "ad_group_criterion.negative",
  "ad_group_criterion.keyword.text",
  "ad_group_criterion.keyword.match_type",
  "ad_group.id",
  "ad_group.name",
];

function renderKeywordMarkdown(row: GaqlRow): string {
  const c = row.adGroupCriterion as Record<string, unknown>;
  const keyword = c.keyword as Record<string, unknown>;
  return `- \`${c.criterionId}\` **${keyword.matchType}**: "${keyword.text}"${c.negative ? " _(negative)_" : ""} — ${c.status}`;
}

export function registerKeywordTools(server: McpServer): void {
  server.registerTool(
    "google_ads_add_keywords",
    {
      title: "Add Google Ads Keywords",
      description: `Add targeting (or negative) keywords to an ad group. This is Search campaigns' equivalent of audience/interest targeting on other ad platforms — ad groups themselves carry no inline targeting, criteria like keywords are separate resources attached to them.

Args:
  - ad_group_id (string): required
  - keywords (array): up to 20 per call, each { text, match_type: 'EXACT'|'PHRASE'|'BROAD' }
  - negative (boolean, default false): true excludes these from matching instead of targeting them
  - response_format ('markdown'|'json', default markdown)

Returns the created criterion ids.

Don't use when: you want a negative keyword that blocks matching account-wide for one campaign rather than one ad group — use google_ads_add_campaign_negative_keywords instead.

Error Handling:
  - "Invalid argument" if a keyword's text violates Google's keyword text policy (length, punctuation)`,
      inputSchema: AddKeywordsInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: AddKeywordsInput) => {
      try {
        const operations = params.keywords.map((kw) => ({
          create: {
            adGroup: resourceName("adGroups", params.ad_group_id, params.customer_id),
            status: "ENABLED",
            negative: params.negative,
            keyword: { text: kw.text, matchType: kw.match_type },
          },
        }));
        const results = await mutate("adGroupCriteria", operations, params.customer_id);
        const ids = results.map((r) => r.resourceName.split("~").pop());
        return buildResponse(
          { ad_group_id: params.ad_group_id, criterion_ids: ids },
          `Added ${results.length} ${params.negative ? "negative " : ""}keyword(s) to ad group \`${params.ad_group_id}\`: ${ids.join(", ")}`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_list_keywords",
    {
      title: "List Google Ads Keywords",
      description: `List keyword criteria on an ad group.

Read-only.

Args:
  - ad_group_id (string): required
  - negative_only (boolean, default false): list only negative keywords
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: ListKeywordsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListKeywordsInput) => {
      try {
        const conditions = [`ad_group.id = ${Number(params.ad_group_id)}`, `ad_group_criterion.type = 'KEYWORD'`];
        if (params.negative_only) conditions.push("ad_group_criterion.negative = true");

        const query = `SELECT ${KEYWORD_FIELDS.join(", ")} FROM ad_group_criterion WHERE ${conditions.join(" AND ")} ORDER BY ad_group_criterion.criterion_id`;
        const paged = await searchPaged(query, params.limit, params.after, params.customer_id);

        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No keywords found for this ad group." }] };
        }

        const markdown = [`# Keywords (${paged.count})`, "", ...paged.items.map(renderKeywordMarkdown)].join("\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_remove_keyword",
    {
      title: "Remove Google Ads Keyword",
      description: `Permanently remove a keyword criterion from an ad group.

Args:
  - ad_group_id (string): required
  - criterion_id (string): required, from google_ads_list_keywords`,
      inputSchema: RemoveKeywordInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: RemoveKeywordInput) => {
      try {
        await mutate(
          "adGroupCriteria",
          [{ remove: resourceName("adGroupCriteria", `${params.ad_group_id}~${params.criterion_id}`, params.customer_id) }],
          params.customer_id
        );
        return buildResponse(
          { ad_group_id: params.ad_group_id, criterion_id: params.criterion_id, removed: true },
          `Removed keyword criterion \`${params.criterion_id}\` from ad group \`${params.ad_group_id}\`.`,
          ResponseFormat.MARKDOWN
        );
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_add_campaign_negative_keywords",
    {
      title: "Add Campaign-Level Negative Keywords",
      description: `Add negative keywords at the campaign level — excluded from matching across every ad group in the campaign, instead of just one.

Args:
  - campaign_id (string): required
  - keywords (array): up to 20 per call, each { text, match_type: 'EXACT'|'PHRASE'|'BROAD' }
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: AddCampaignNegativeKeywordsInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: AddCampaignNegativeKeywordsInput) => {
      try {
        const operations = params.keywords.map((kw) => ({
          create: {
            campaign: resourceName("campaigns", params.campaign_id, params.customer_id),
            negative: true,
            keyword: { text: kw.text, matchType: kw.match_type },
          },
        }));
        const results = await mutate("campaignCriteria", operations, params.customer_id);
        const ids = results.map((r) => r.resourceName.split("~").pop());
        return buildResponse(
          { campaign_id: params.campaign_id, criterion_ids: ids },
          `Added ${results.length} campaign-level negative keyword(s) to campaign \`${params.campaign_id}\`: ${ids.join(", ")}`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );
}
