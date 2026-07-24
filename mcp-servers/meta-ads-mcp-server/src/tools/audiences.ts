import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CreateCustomAudienceInput,
  CreateCustomAudienceInputSchema,
  CreateLookalikeAudienceInput,
  CreateLookalikeAudienceInputSchema,
  DeleteAudienceInput,
  DeleteAudienceInputSchema,
  ListAudiencesInput,
  ListAudiencesInputSchema,
} from "../schemas/audiences.js";
import { ResponseFormat } from "../schemas/common.js";
import { handleGraphApiError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { getAdAccountId, graphRequest, listPaged } from "../services/graphApiClient.js";
import type { AudienceRef } from "../types.js";

const AUDIENCE_FIELDS = "id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,operation_status,delivery_status";

function renderAudienceMarkdown(a: AudienceRef): string {
  const size =
    a.approximate_count_lower_bound !== undefined
      ? `${a.approximate_count_lower_bound}-${a.approximate_count_upper_bound}`
      : "not yet estimated";
  return [
    `## ${a.name} (\`${a.id}\`)`,
    `- **Type**: ${a.subtype ?? "n/a"}`,
    `- **Estimated size**: ${size}`,
    `- **Status**: ${a.operation_status?.description ?? "n/a"}`,
  ].join("\n");
}

export function registerAudienceTools(server: McpServer): void {
  server.registerTool(
    "meta_ads_create_custom_audience",
    {
      title: "Create Meta Ads Custom Audience",
      description: `Create an empty Custom Audience shell in the ad account (e.g. for a website-visitors or customer-list audience you'll populate later).

This tool does NOT upload member data (emails/phone numbers) — that requires hashing PII with SHA-256 before sending it to Meta, which is a separate, more sensitive operation not covered by this server yet.

Args:
  - name (string): required
  - description (string, optional)
  - customer_file_source (string, default USER_PROVIDED_ONLY): how the underlying data was collected
  - response_format ('markdown'|'json', default markdown)

Returns the created audience's id.

Don't use when: you want an audience modeled on an existing one — use meta_ads_create_lookalike_audience instead.`,
      inputSchema: CreateCustomAudienceInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CreateCustomAudienceInput) => {
      try {
        const created = await graphRequest<{ id: string }>(`/${getAdAccountId()}/customaudiences`, {
          method: "POST",
          params: {
            name: params.name,
            subtype: "CUSTOM",
            customer_file_source: params.customer_file_source,
            ...(params.description ? { description: params.description } : {}),
          },
        });
        return buildResponse(
          { id: created.id, name: params.name },
          `Created Custom Audience **${params.name}** (\`${created.id}\`). It has no members yet.`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_create_lookalike_audience",
    {
      title: "Create Meta Ads Lookalike Audience",
      description: `Create a Lookalike Audience modeled on an existing Custom Audience.

Args:
  - name, origin_audience_id (string): required
  - country (string): required, ISO 3166-1 alpha-2, e.g. 'AR'
  - ratio (number, default 0.05): 0.01 (closest match, smallest reach) to 0.20 (broadest, largest reach)
  - response_format ('markdown'|'json', default markdown)

Returns the created audience's id.

Error Handling:
  - "Invalid parameter" if origin_audience_id doesn't have enough matched users yet (Meta requires a minimum seed size, typically 100+)`,
      inputSchema: CreateLookalikeAudienceInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CreateLookalikeAudienceInput) => {
      try {
        const created = await graphRequest<{ id: string }>(`/${getAdAccountId()}/customaudiences`, {
          method: "POST",
          params: {
            name: params.name,
            subtype: "LOOKALIKE",
            origin_audience_id: params.origin_audience_id,
            lookalike_spec: JSON.stringify({ type: "similarity", ratio: params.ratio, country: params.country }),
          },
        });
        return buildResponse(
          { id: created.id, name: params.name, origin_audience_id: params.origin_audience_id },
          `Created Lookalike Audience **${params.name}** (\`${created.id}\`) based on \`${params.origin_audience_id}\` in ${params.country}.`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_list_audiences",
    {
      title: "List Meta Ads Audiences",
      description: `List Custom and Lookalike Audiences in the configured ad account.

Read-only.

Args:
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor
  - response_format ('markdown'|'json', default markdown)

Returns paginated audiences with id, name, subtype, estimated size, and status.`,
      inputSchema: ListAudiencesInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListAudiencesInput) => {
      try {
        const paged = await listPaged<AudienceRef>(`/${getAdAccountId()}/customaudiences`, { fields: AUDIENCE_FIELDS }, params.limit);
        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No audiences found in this ad account." }] };
        }
        const markdown = [`# Audiences (${paged.count})`, "", ...paged.items.map(renderAudienceMarkdown)].join("\n\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_delete_audience",
    {
      title: "Delete Meta Ads Audience",
      description: `Permanently delete a Custom or Lookalike Audience. This cannot be undone, and any ad set still targeting it will lose that targeting criterion.

Args:
  - audience_id (string): required`,
      inputSchema: DeleteAudienceInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: DeleteAudienceInput) => {
      try {
        await graphRequest<{ success: boolean }>(`/${params.audience_id}`, { method: "DELETE" });
        return buildResponse({ audience_id: params.audience_id, deleted: true }, `Deleted audience \`${params.audience_id}\`.`, ResponseFormat.MARKDOWN);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );
}
