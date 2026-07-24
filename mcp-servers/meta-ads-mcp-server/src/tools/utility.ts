import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GetAdAccountInput, GetAdAccountInputSchema, ListPagesInput, ListPagesInputSchema } from "../schemas/utility.js";
import { handleGraphApiError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { getAdAccountId, graphRequest, listPaged } from "../services/graphApiClient.js";
import type { AdAccount, Page } from "../types.js";

const AD_ACCOUNT_FIELDS = "id,account_id,name,account_status,currency,timezone_name,amount_spent,spend_cap,balance";

export function registerUtilityTools(server: McpServer): void {
  server.registerTool(
    "meta_ads_get_ad_account",
    {
      title: "Get Meta Ads Account Info",
      description: `Fetch status, currency, spend, and spend cap for the configured ad account (META_AD_ACCOUNT_ID). Useful as a first call to confirm the token/account setup is working.

Read-only. No arguments besides response_format.

Returns id, name, account_status (1=ACTIVE, 2=DISABLED, 3=UNSETTLED, ...), currency, timezone, amount_spent, spend_cap, balance.

Error Handling:
  - "Permission denied" if the System User doesn't have this ad account assigned as an asset
  - "invalid or expired" if META_ACCESS_TOKEN needs to be regenerated`,
      inputSchema: GetAdAccountInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetAdAccountInput) => {
      try {
        const account = await graphRequest<AdAccount>(`/${getAdAccountId()}`, { params: { fields: AD_ACCOUNT_FIELDS } });
        const markdown = [
          `## ${account.name ?? account.id} (\`${account.id}\`)`,
          `- **Status code**: ${account.account_status ?? "n/a"}`,
          `- **Currency**: ${account.currency ?? "n/a"}`,
          `- **Timezone**: ${account.timezone_name ?? "n/a"}`,
          `- **Amount spent**: ${account.amount_spent ?? "n/a"}`,
          `- **Spend cap**: ${account.spend_cap ?? "none"}`,
          `- **Balance**: ${account.balance ?? "n/a"}`,
        ].join("\n");
        return buildResponse(account as unknown as Record<string, unknown>, markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_ads_list_pages",
    {
      title: "List Meta Pages",
      description: `List the Facebook Pages assigned to this server's System User — needed as the page_id argument for meta_ads_create_ad_creative.

Read-only.

Args:
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor
  - response_format ('markdown'|'json', default markdown)

Returns paginated Pages with id, name, category.

Error Handling:
  - Empty result means the System User has no Pages assigned yet — add them in Business Settings > Accounts > Pages`,
      inputSchema: ListPagesInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListPagesInput) => {
      try {
        const paged = await listPaged<Page>("/me/accounts", { fields: "id,name,category" }, params.limit);
        if (!paged.items.length) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No Pages found. Assign the Page(s) this System User should manage in Business Settings > Accounts > Pages.",
              },
            ],
          };
        }
        const markdown = [`# Pages (${paged.count})`, "", ...paged.items.map((p) => `- **${p.name}** (\`${p.id}\`) — ${p.category ?? "n/a"}`)].join(
          "\n"
        );
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );
}
