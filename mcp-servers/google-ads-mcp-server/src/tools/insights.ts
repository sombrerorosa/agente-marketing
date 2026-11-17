import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DEFAULT_METRICS,
  GetInsightsInput,
  GetInsightsInputSchema,
  GetKeywordInsightsInput,
  GetKeywordInsightsInputSchema,
  GetSearchTermInsightsInput,
  GetSearchTermInsightsInputSchema,
} from "../schemas/insights.js";
import { handleGoogleAdsError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { searchPaged } from "../services/googleAdsClient.js";
import type { GaqlRow } from "../types.js";

const FROM_RESOURCE: Record<string, string> = {
  account: "customer",
  campaign: "campaign",
  ad_group: "ad_group",
  ad: "ad_group_ad",
};

const ID_FIELDS: Record<string, string[]> = {
  account: [],
  campaign: ["campaign.id", "campaign.name"],
  ad_group: ["campaign.id", "campaign.name", "ad_group.id", "ad_group.name"],
  ad: ["campaign.id", "campaign.name", "ad_group.id", "ad_group.name", "ad_group_ad.ad.id"],
};

const BREAKDOWN_FIELDS: Record<string, string> = {
  day: "segments.date",
  device: "segments.device",
  age_range: "segments.age_range",
  gender: "segments.gender",
};

function microsToUnits(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(Number(value) / 1_000_000) : "n/a";
}

function label(row: GaqlRow): string {
  const ad = ((row.adGroupAd as Record<string, unknown> | undefined)?.ad as Record<string, unknown> | undefined)?.id;
  const adGroup = row.adGroup as Record<string, unknown> | undefined;
  const campaign = row.campaign as Record<string, unknown> | undefined;
  if (ad) return `Ad \`${ad}\``;
  if (adGroup) return `${adGroup.name} (\`${adGroup.id}\`)`;
  if (campaign) return `${campaign.name} (\`${campaign.id}\`)`;
  return "Account";
}

function renderInsightRow(row: GaqlRow): string {
  const m = row.metrics as Record<string, unknown> | undefined;
  const segments = row.segments as Record<string, unknown> | undefined;
  const scope = segments?.date ? ` (${segments.date})` : "";
  return [
    `## ${label(row)}${scope}`,
    `- **Impressions**: ${m?.impressions ?? "0"}`,
    `- **Clicks**: ${m?.clicks ?? "0"}${m?.ctr ? ` (CTR ${(Number(m.ctr) * 100).toFixed(2)}%)` : ""}`,
    `- **Cost**: ${microsToUnits(m?.costMicros)}`,
    `- **Avg. CPC**: ${m?.averageCpc ? microsToUnits(m.averageCpc) : "n/a"}`,
    `- **Conversions**: ${m?.conversions ?? "0"} (value: ${m?.conversionsValue ?? "0"})`,
  ].join("\n");
}

/** Shared date-range validation/condition-building for the keyword and search-term insight tools below. */
function dateCondition(params: { date_preset?: string; since?: string; until?: string }): { error: string } | { condition: string } {
  if (!params.date_preset && !(params.since && params.until)) {
    return { error: "Error: Provide either date_preset or both since and until." };
  }
  if (params.date_preset && params.since) {
    return { error: "Error: Provide either date_preset or since/until, not both." };
  }
  return {
    condition: params.date_preset ? `segments.date DURING ${params.date_preset}` : `segments.date BETWEEN '${params.since}' AND '${params.until}'`,
  };
}

const KEYWORD_INSIGHT_FIELDS = [
  "campaign.id",
  "campaign.name",
  "ad_group.id",
  "ad_group.name",
  "ad_group_criterion.criterion_id",
  "ad_group_criterion.keyword.text",
  "ad_group_criterion.keyword.match_type",
  "ad_group_criterion.status",
  "ad_group_criterion.quality_info.quality_score",
  "metrics.impressions",
  "metrics.clicks",
  "metrics.cost_micros",
  "metrics.conversions",
  "metrics.conversions_value",
  "metrics.search_impression_share",
];

function renderKeywordInsightRow(row: GaqlRow): string {
  const campaign = row.campaign as Record<string, unknown> | undefined;
  const adGroup = row.adGroup as Record<string, unknown> | undefined;
  const criterion = row.adGroupCriterion as Record<string, unknown> | undefined;
  const keyword = criterion?.keyword as Record<string, unknown> | undefined;
  const qualityInfo = criterion?.qualityInfo as Record<string, unknown> | undefined;
  const m = row.metrics as Record<string, unknown> | undefined;
  const sis = m?.searchImpressionShare;
  return [
    `## "${keyword?.text ?? "n/a"}" (${keyword?.matchType ?? "n/a"}) — \`${criterion?.criterionId ?? "n/a"}\``,
    `- **Campaign**: ${campaign?.name ?? "n/a"} (\`${campaign?.id ?? "n/a"}\`) · **Ad group**: ${adGroup?.name ?? "n/a"} (\`${adGroup?.id ?? "n/a"}\`)`,
    `- **Status**: ${criterion?.status ?? "n/a"} · **Quality Score**: ${qualityInfo?.qualityScore ?? "n/a"}`,
    `- **Impressions**: ${m?.impressions ?? "0"} · **Clicks**: ${m?.clicks ?? "0"} · **Cost**: ${microsToUnits(m?.costMicros)}`,
    `- **Conversions**: ${m?.conversions ?? "0"} (value: ${m?.conversionsValue ?? "0"}) · **Search Impr. Share**: ${
      typeof sis === "number" || typeof sis === "string" ? `${(Number(sis) * 100).toFixed(2)}%` : "n/a"
    }`,
  ].join("\n");
}

const SEARCH_TERM_INSIGHT_FIELDS = [
  "search_term_view.search_term",
  "search_term_view.status",
  "campaign.id",
  "campaign.name",
  "ad_group.id",
  "ad_group.name",
  "metrics.impressions",
  "metrics.clicks",
  "metrics.cost_micros",
  "metrics.conversions",
];

function renderSearchTermInsightRow(row: GaqlRow): string {
  const stv = row.searchTermView as Record<string, unknown> | undefined;
  const campaign = row.campaign as Record<string, unknown> | undefined;
  const adGroup = row.adGroup as Record<string, unknown> | undefined;
  const m = row.metrics as Record<string, unknown> | undefined;
  return [
    `## "${stv?.searchTerm ?? "n/a"}" — ${stv?.status ?? "n/a"}`,
    `- **Campaign**: ${campaign?.name ?? "n/a"} (\`${campaign?.id ?? "n/a"}\`) · **Ad group**: ${adGroup?.name ?? "n/a"} (\`${adGroup?.id ?? "n/a"}\`)`,
    `- **Impressions**: ${m?.impressions ?? "0"} · **Clicks**: ${m?.clicks ?? "0"} · **Cost**: ${microsToUnits(m?.costMicros)} · **Conversions**: ${m?.conversions ?? "0"}`,
  ].join("\n");
}

export function registerInsightTools(server: McpServer): void {
  server.registerTool(
    "google_ads_get_insights",
    {
      title: "Get Google Ads Insights",
      description: `Fetch performance metrics (impressions, clicks, cost, CTR, CPC, conversions) via GAQL, at the account, campaign, ad group, or ad level, over a date range.

Read-only.

Args:
  - level ('account'|'campaign'|'ad_group'|'ad', default 'campaign'): output granularity.
  - campaign_id (string, optional): scope to one campaign — valid at any level except 'account'.
  - ad_group_id (string, optional): scope to one ad group — valid only when level is 'ad_group' or 'ad'.
  - ad_id (string, optional): scope to one ad — requires ad_group_id, only valid when level is 'ad'.
  - date_preset (string, optional): one of TODAY, YESTERDAY, LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, THIS_MONTH, LAST_MONTH. Provide this OR since+until.
  - since / until (string, optional): custom range as 'YYYY-MM-DD'. Provide both together.
  - metrics (string[], optional): GAQL metric fields, e.g. 'metrics.impressions'. Defaults to impressions, clicks, cost_micros, ctr, average_cpc, conversions, conversions_value.
  - breakdowns (string[], optional): split by segment — 'day', 'device', 'age_range', 'gender'. At most 2 recommended.
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor
  - response_format ('markdown'|'json', default markdown)

Returns paginated rows, one per object/segment combination, with the requested metrics. Cost fields come back in micros (currency unit × 1,000,000) from the API; the markdown view converts them to units, the json view does not.

Error Handling:
  - Returns an error if neither date_preset nor since+until is provided
  - Returns an error if a scoping filter doesn't match the requested level (e.g. ad_group_id with level='campaign')`,
      inputSchema: GetInsightsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetInsightsInput) => {
      try {
        if (!params.date_preset && !(params.since && params.until)) {
          return errorResponse("Error: Provide either date_preset or both since and until.");
        }
        if (params.date_preset && params.since) {
          return errorResponse("Error: Provide either date_preset or since/until, not both.");
        }
        if (params.level === "account" && (params.campaign_id || params.ad_group_id || params.ad_id)) {
          return errorResponse("Error: campaign_id/ad_group_id/ad_id can't be used with level='account'. Pick a more granular level.");
        }
        if (params.ad_group_id && params.level !== "ad_group" && params.level !== "ad") {
          return errorResponse("Error: ad_group_id requires level='ad_group' or level='ad'.");
        }
        if (params.ad_id && params.level !== "ad") {
          return errorResponse("Error: ad_id requires level='ad'.");
        }
        if (params.ad_id && !params.ad_group_id) {
          return errorResponse("Error: ad_id requires ad_group_id to also be set (Google's ad resource name is composite).");
        }

        const metrics = params.metrics?.length ? params.metrics : DEFAULT_METRICS;
        const breakdownFields = (params.breakdowns ?? []).map((b) => BREAKDOWN_FIELDS[b]);
        const selectFields = [...ID_FIELDS[params.level], ...breakdownFields, ...metrics];

        const conditions: string[] = [];
        conditions.push(params.date_preset ? `segments.date DURING ${params.date_preset}` : `segments.date BETWEEN '${params.since}' AND '${params.until}'`);
        if (params.campaign_id) conditions.push(`campaign.id = ${Number(params.campaign_id)}`);
        if (params.ad_group_id) conditions.push(`ad_group.id = ${Number(params.ad_group_id)}`);
        if (params.ad_id) conditions.push(`ad_group_ad.ad.id = ${Number(params.ad_id)}`);

        const query = `SELECT ${selectFields.join(", ")} FROM ${FROM_RESOURCE[params.level]} WHERE ${conditions.join(" AND ")}`;

        const paged = await searchPaged(query, params.limit, params.after, params.customer_id);
        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No insights data found for the given range/filters." }] };
        }

        const markdown = [`# Insights (${paged.count} rows)`, "", ...paged.items.map(renderInsightRow)].join("\n\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_get_keyword_insights",
    {
      title: "Get Google Ads Keyword Insights",
      description: `Fetch keyword-level performance via GAQL's keyword_view — impressions, clicks, cost, conversions, Quality Score, and search impression share per keyword, over a date range.

Read-only.

Args:
  - campaign_id (string, optional): scope to one campaign. Omit to report across the whole account.
  - ad_group_id (string, optional): scope to one ad group.
  - date_preset (string, optional): one of TODAY, YESTERDAY, LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, THIS_MONTH, LAST_MONTH. Provide this OR since+until.
  - since / until (string, optional): custom range as 'YYYY-MM-DD'. Provide both together.
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor
  - response_format ('markdown'|'json', default markdown)

Returns rows sorted by clicks descending, one per keyword. Quality Score is only populated once Google has enough data for that keyword — expect "n/a" for newer or low-volume keywords. Cost comes back in micros from the API; the markdown view converts it to units, the json view does not.

Don't use when: you want the account/campaign/ad group/ad rollup — use google_ads_get_insights instead. Don't use when: you want to see what people actually searched before matching to your keywords — use google_ads_get_search_term_insights instead.

Error Handling:
  - Returns an error if neither date_preset nor since+until is provided`,
      inputSchema: GetKeywordInsightsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetKeywordInsightsInput) => {
      try {
        const dc = dateCondition(params);
        if ("error" in dc) return errorResponse(dc.error);

        const conditions: string[] = [dc.condition];
        if (params.campaign_id) conditions.push(`campaign.id = ${Number(params.campaign_id)}`);
        if (params.ad_group_id) conditions.push(`ad_group.id = ${Number(params.ad_group_id)}`);

        const query = `SELECT ${KEYWORD_INSIGHT_FIELDS.join(", ")} FROM keyword_view WHERE ${conditions.join(" AND ")} ORDER BY metrics.clicks DESC`;

        const paged = await searchPaged(query, params.limit, params.after, params.customer_id);
        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No keyword insights data found for the given range/filters." }] };
        }

        const markdown = [`# Keyword Insights (${paged.count} rows)`, "", ...paged.items.map(renderKeywordInsightRow)].join("\n\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_get_search_term_insights",
    {
      title: "Get Google Ads Search Term Insights",
      description: `Fetch the actual search terms that triggered your ads via GAQL's search_term_view — impressions, clicks, cost, and conversions per search term, over a date range. This is the raw queries people typed, before matching to your keywords; use it to find new keyword candidates or terms to add as negatives.

Read-only.

Args:
  - campaign_id (string, optional): scope to one campaign. Omit to report across the whole account.
  - ad_group_id (string, optional): scope to one ad group.
  - date_preset (string, optional): one of TODAY, YESTERDAY, LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS, THIS_MONTH, LAST_MONTH. Provide this OR since+until.
  - since / until (string, optional): custom range as 'YYYY-MM-DD'. Provide both together.
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor
  - response_format ('markdown'|'json', default markdown)

Returns rows sorted by clicks descending, one per search term/ad group combination. Cost comes back in micros from the API; the markdown view converts it to units, the json view does not.

Don't use when: you want keyword-level performance (Quality Score, search impression share) for terms you're already targeting — use google_ads_get_keyword_insights instead.

Error Handling:
  - Returns an error if neither date_preset nor since+until is provided`,
      inputSchema: GetSearchTermInsightsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetSearchTermInsightsInput) => {
      try {
        const dc = dateCondition(params);
        if ("error" in dc) return errorResponse(dc.error);

        const conditions: string[] = [dc.condition];
        if (params.campaign_id) conditions.push(`campaign.id = ${Number(params.campaign_id)}`);
        if (params.ad_group_id) conditions.push(`ad_group.id = ${Number(params.ad_group_id)}`);

        const query = `SELECT ${SEARCH_TERM_INSIGHT_FIELDS.join(", ")} FROM search_term_view WHERE ${conditions.join(" AND ")} ORDER BY metrics.clicks DESC`;

        const paged = await searchPaged(query, params.limit, params.after, params.customer_id);
        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No search term insights data found for the given range/filters." }] };
        }

        const markdown = [`# Search Term Insights (${paged.count} rows)`, "", ...paged.items.map(renderSearchTermInsightRow)].join("\n\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );
}
