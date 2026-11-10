import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DeleteOrganicContentInput,
  DeleteOrganicContentInputSchema,
  GetAdAccountInput,
  GetAdAccountInputSchema,
  GetInstagramAccountInput,
  GetInstagramAccountInputSchema,
  GetTokenPermissionsInput,
  GetTokenPermissionsInputSchema,
  ListPagesInput,
  ListPagesInputSchema,
} from "../schemas/utility.js";
import { ResponseFormat } from "../schemas/common.js";
import { handleGraphApiError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { getAccessToken, getAdAccountId, graphRequest, listPaged } from "../services/graphApiClient.js";
import type { AdAccount, InstagramAccount, Page } from "../types.js";

/** Permissions this server's tools can exercise, mapped to the scope each one needs. */
const EXPECTED_PERMISSIONS: Array<{ scope: string; usedFor: string }> = [
  { scope: "ads_management", usedFor: "create/update/delete campaigns, ad sets, ads, creatives" },
  { scope: "ads_read", usedFor: "read campaigns, ad sets, ads, insights" },
  { scope: "business_management", usedFor: "access Business Manager assets (ad account, Pages)" },
  { scope: "pages_show_list", usedFor: "list Pages assigned to this System User" },
  { scope: "pages_read_engagement", usedFor: "read Facebook Page posts/engagement" },
  { scope: "read_insights", usedFor: "read ad/account insights" },
  { scope: "pages_manage_posts", usedFor: "publish/delete Facebook Page posts (meta_organic_*)" },
  { scope: "instagram_basic", usedFor: "read Instagram Business Account + media" },
  { scope: "instagram_content_publish", usedFor: "publish Instagram posts/carousels" },
];

interface DebugTokenData {
  is_valid: boolean;
  scopes?: string[];
  expires_at?: number;
  data_access_expires_at?: number;
  user_id?: string;
  type?: string;
  application?: string;
}

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
    "meta_ads_get_token_permissions",
    {
      title: "Check Meta Token Permissions",
      description: `Introspect META_ACCESS_TOKEN via Meta's /debug_token endpoint to see exactly which OAuth scopes are granted — a direct, read-only way to confirm whether this connector can analyze, publish, or delete content, instead of inferring it from trial and error.

Read-only. No arguments besides response_format.

Returns is_valid, expiry (System User tokens are typically "never expires"), and the full list of granted vs. missing scopes against everything this server's tools can use (ads management/read, Pages, Instagram, insights).

Note: this only reports the token's OWN scopes. Whether it can act on a SPECIFIC Page/ad account/Instagram account also depends on that asset being assigned to this token's System User in Business Settings — use meta_ads_list_pages and meta_organic_get_instagram_account to confirm per-asset access.

Error Handling:
  - "invalid or expired" if META_ACCESS_TOKEN needs to be regenerated`,
      inputSchema: GetTokenPermissionsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetTokenPermissionsInput) => {
      try {
        const token = getAccessToken();
        const result = await graphRequest<{ data: DebugTokenData }>("/debug_token", {
          params: { input_token: token, access_token: token },
        });
        const info = result.data;
        const granted = new Set(info.scopes ?? []);
        const missing = EXPECTED_PERMISSIONS.filter((p) => !granted.has(p.scope));
        const expiry = info.expires_at === 0 ? "never expires" : info.expires_at ? new Date(info.expires_at * 1000).toISOString() : "n/a";

        const markdown = [
          `## Token Permissions`,
          `- **Valid**: ${info.is_valid ? "yes" : "no"}`,
          `- **Type**: ${info.type ?? "n/a"}`,
          `- **Expires**: ${expiry}`,
          "",
          "### Granted scopes",
          ...(info.scopes?.length ? info.scopes.map((s) => `- ${s}`) : ["- (none)"]),
          "",
          "### Missing (needed by this server's tools)",
          ...(missing.length ? missing.map((p) => `- **${p.scope}** — needed for: ${p.usedFor}`) : ["- (none — all expected scopes are granted)"]),
        ].join("\n");

        return buildResponse(
          { is_valid: info.is_valid, type: info.type, expires_at: info.expires_at, scopes: info.scopes ?? [], missing_scopes: missing.map((p) => p.scope) },
          markdown,
          params.response_format
        );
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

  server.registerTool(
    "meta_organic_get_instagram_account",
    {
      title: "Get Instagram Business Account for a Page",
      description: `Fetch the Instagram Business Account linked to a Facebook Page, if any — needed as the ig_user_id argument for the meta_organic_*_instagram_* / *_ig_* tools.

Read-only.

Args:
  - page_id (string): required
  - response_format ('markdown'|'json', default markdown)

Returns id, username, follower count.

Error Handling:
  - Empty/missing result means this Page has no Instagram Business Account connected — link one in Meta Business Suite first`,
      inputSchema: GetInstagramAccountInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetInstagramAccountInput) => {
      try {
        const page = await graphRequest<{ instagram_business_account?: InstagramAccount }>(`/${params.page_id}`, {
          params: { fields: "instagram_business_account{id,username,profile_picture_url,followers_count}" },
        });
        const ig = page.instagram_business_account;
        if (!ig) {
          return errorResponse(`Error: Page ${params.page_id} has no Instagram Business Account connected. Link one in Meta Business Suite > Settings > Linked Accounts.`);
        }
        const markdown = [`## @${ig.username ?? "(no username)"} (\`${ig.id}\`)`, `- **Followers**: ${ig.followers_count ?? "n/a"}`].join("\n");
        return buildResponse(ig as unknown as Record<string, unknown>, markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );

  server.registerTool(
    "meta_organic_delete_content",
    {
      title: "Delete Organic Content",
      description: `Permanently delete an organic Facebook post/photo/video. This cannot be undone.

Doesn't work for Instagram — the Instagram Graph API doesn't expose a reliable media-deletion endpoint; delete Instagram posts from the Instagram app or Meta Business Suite instead.

Args:
  - id (string): required — a Facebook post/photo/video id`,
      inputSchema: DeleteOrganicContentInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: DeleteOrganicContentInput) => {
      try {
        await graphRequest(`/${params.id}`, { method: "DELETE" });
        return buildResponse({ id: params.id, deleted: true }, `Deleted \`${params.id}\`.`, ResponseFormat.MARKDOWN);
      } catch (error) {
        return errorResponse(handleGraphApiError(error));
      }
    }
  );
}
