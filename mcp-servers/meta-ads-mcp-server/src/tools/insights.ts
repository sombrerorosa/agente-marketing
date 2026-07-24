import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_FIELDS, GetInsightsInput, GetInsightsInputSchema } from "../schemas/insights.js";
import { handleGraphApiError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { getAdAccountId, listPaged } from "../services/graphApiClient.js";
import type { InsightRow } from "../types.js";

function fieldsForLevel(level: string, requested?: string[]): string[] {
  const base = requested?.length ? requested : DEFAULT_FIELDS;
  const idFields: string[] = ["date_start", "date_stop"];
  if (level === "campaign" || level === "adset" || level === "ad") idFields.push("campaign_id", "campaign_name");
  if (level === "adset" || level === "ad") idFields.push("adset_id", "adset_name");
  if (level === "ad") idFields.push("ad_id", "ad_name");
  return Array.from(new Set([...idFields, ...base]));
}

function renderInsightRow(row: InsightRow): string {
  const label = row.ad_name ?? row.adset_name ?? row.campaign_name ?? "Account";
  const range = row.date_start ? ` (${row.date_start} to ${row.date_stop})` : "";
  const actionsSummary = row.actions?.length ? row.actions.map((a) => `${a.action_type}: ${a.value}`).join(", ") : "n/a";
  const roasSummary = row.purchase_roas?.length ? row.purchase_roas.map((a) => `${a.value}x`).join(", ") : "n/a";
  return [
    `## ${label}${range}`,
    `- **Spend**: ${row.spend ?? "0"}`,
    `- **Impressions**: ${row.impressions ?? "0"}`,
    `- **Clicks**: ${row.clicks ?? "0"}${row.ctr ? ` (CTR ${row.ctr}%)` : ""}`,
    `- **CPC / CPM**: ${row.cpc ?? "n/a"} / ${row.cpm ?? "n/a"}`,
    `- **Actions**: ${actionsSummary}`,
    `- **Purchase ROAS**: ${roasSummary}`,
  ].join("\n");
}

export function registerInsightTools(server: McpServer): void {
  server.registerTool(
    "meta_ads_get_insights",
    {
      title: "Get Meta Ads Insights",
      description: `Fetch performance metrics (spend, impressions, clicks, CTR, CPA, ROAS, etc.) for the ad account or a specific campaign/ad set/ad, over a date range.

Read-only.

Args:
  - object_id (string, optional): campaign/ad set/ad ID to scope to. Omit to report on the whole ad account.
  - level ('account'|'campaign'|'adset'|'ad', default 'campaign'): required when object_id is omitted; when object_id is set, controls whether results roll up or break out by children (e.g. object_id=a campaign with level='ad' returns one row per ad in it).
  - date_preset (string, optional): relative range, e.g. 'last_30d', 'last_7d', 'this_month'. Provide this OR since+until.
  - since / until (string, optional): custom range as 'YYYY-MM-DD'. Provide both together.
  - fields (string[], optional): metrics to return. Defaults to spend, impressions, clicks, ctr, cpc, cpm, reach, frequency, actions, purchase_roas.
  - breakdowns (string[], optional): split by dimension, e.g. ['age','gender']. At most 2 recommended to avoid combinatorial blowup.
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor
  - response_format ('markdown'|'json', default markdown)

Returns paginated rows, one per object/date/breakdown combination, with the requested metrics.

Error Handling:
  - Returns an error if neither date_preset nor since+until is provided
  - "Invalid parameter" if a breakdown is incompatible with the requested level`,
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

        const endpoint = params.object_id ? `/${params.object_id}/insights` : `/${getAdAccountId()}/insights`;
        const dateParams = params.date_preset
          ? { date_preset: params.date_preset }
          : { time_range: JSON.stringify({ since: params.since, until: params.until }) };

        const paged = await listPaged<InsightRow>(
          endpoint,
          {
            level: params.level,
            fields: fieldsForLevel(params.level, params.fields).join(","),
            ...dateParams,
            ...(params.breakdowns?.length ? { breakdowns: params.breakdowns.join(",") } : {}),
          },
          params.limit
        );

        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No insights data found for the given range/filters." }] };
        }

        const markdown = [`# Insights (${paged.count} rows)`, "", ...paged.items.map(renderInsightRow)].join("\n\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );
}
