import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CreateCustomerMatchListInput,
  CreateCustomerMatchListInputSchema,
  DeleteUserListInput,
  DeleteUserListInputSchema,
  GetUserListInput,
  GetUserListInputSchema,
  ListUserListsInput,
  ListUserListsInputSchema,
} from "../schemas/audiences.js";
import { ResponseFormat } from "../schemas/common.js";
import { handleGoogleAdsError } from "../services/errorHandler.js";
import { buildResponse, errorResponse, pagedJson } from "../services/formatting.js";
import { mutate, resourceName, searchOne, searchPaged } from "../services/googleAdsClient.js";
import type { GaqlRow } from "../types.js";

const USER_LIST_FIELDS = [
  "user_list.id",
  "user_list.name",
  "user_list.description",
  "user_list.membership_status",
  "user_list.size_for_display",
  "user_list.size_for_search",
  "user_list.type",
];

function renderUserListMarkdown(row: GaqlRow): string {
  const ul = row.userList as Record<string, unknown>;
  return [
    `## ${ul.name} (\`${ul.id}\`)`,
    `- **Status**: ${ul.membershipStatus}`,
    `- **Type**: ${ul.type ?? "n/a"}`,
    `- **Size (Display / Search)**: ${ul.sizeForDisplay ?? "n/a"} / ${ul.sizeForSearch ?? "n/a"}`,
    `- **Description**: ${ul.description || "n/a"}`,
  ].join("\n");
}

export function registerAudienceTools(server: McpServer): void {
  server.registerTool(
    "google_ads_create_customer_match_list",
    {
      title: "Create Google Ads Customer Match List",
      description: `Create a Customer Match user list (remarketing audience built from your own first-party data — emails, phone numbers, etc.). This only creates the empty list resource; uploading the actual member data requires OfflineUserDataJobService, which isn't exposed by this server yet — upload members via the Google Ads UI (Audience Manager) after creating the list here, or ask for that as a follow-up.

There's no "lookalike audience" equivalent to create here — Google retired Similar Audiences in 2023 in favor of automatic audience expansion (optimized targeting), which doesn't need a separate audience resource.

Args:
  - name (string): required
  - description (string, optional)
  - membership_life_span_days (number, 0-540, default 540): how long a member stays without a fresh upload. 0 means members never expire.
  - response_format ('markdown'|'json', default markdown)

Returns the created list's id.`,
      inputSchema: CreateCustomerMatchListInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: CreateCustomerMatchListInput) => {
      try {
        const [result] = await mutate("userLists", [
          {
            create: {
              name: params.name,
              ...(params.description ? { description: params.description } : {}),
              membershipLifeSpan: params.membership_life_span_days,
              crmBasedUserList: { uploadKeyType: "CONTACT_INFO" },
            },
          },
        ]);
        const userListId = result.resourceName.split("/").pop()!;
        return buildResponse(
          { id: userListId, name: params.name },
          `Created Customer Match list **${params.name}** (\`${userListId}\`). Upload members via Audience Manager in the Google Ads UI.`,
          params.response_format
        );
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_list_user_lists",
    {
      title: "List Google Ads User Lists",
      description: `List audience (user list) resources in the account — Customer Match lists, remarketing lists built by Google tags, etc.

Read-only. Use google_ads_create_customer_match_list to create a new Customer Match list.

Args:
  - limit (number, default 25, max 100)
  - after (string, optional): pagination cursor
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: ListUserListsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListUserListsInput) => {
      try {
        const query = `SELECT ${USER_LIST_FIELDS.join(", ")} FROM user_list ORDER BY user_list.id`;
        const paged = await searchPaged(query, params.limit, params.after);
        if (!paged.items.length) {
          return { content: [{ type: "text" as const, text: "No user lists found in this account." }] };
        }
        const markdown = [`# User Lists (${paged.count})`, "", ...paged.items.map(renderUserListMarkdown)].join("\n\n");
        return buildResponse(pagedJson(paged), markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_get_user_list",
    {
      title: "Get Google Ads User List",
      description: `Fetch full details for a single user list (audience) by ID.

Args:
  - user_list_id (string): required
  - response_format ('markdown'|'json', default markdown)`,
      inputSchema: GetUserListInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetUserListInput) => {
      try {
        const row = await searchOne(`SELECT ${USER_LIST_FIELDS.join(", ")} FROM user_list WHERE user_list.id = ${Number(params.user_list_id)}`);
        if (!row) return errorResponse(`Error: User list ${params.user_list_id} not found.`);
        return buildResponse(row, renderUserListMarkdown(row), params.response_format);
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_delete_user_list",
    {
      title: "Delete Google Ads User List",
      description: `Permanently remove a user list (audience). This cannot be undone via the API, and campaigns still targeting it will stop using it.

Args:
  - user_list_id (string): required`,
      inputSchema: DeleteUserListInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: DeleteUserListInput) => {
      try {
        await mutate("userLists", [{ remove: resourceName("userLists", params.user_list_id) }]);
        return buildResponse(
          { user_list_id: params.user_list_id, removed: true },
          `Removed user list \`${params.user_list_id}\`.`,
          ResponseFormat.MARKDOWN
        );
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );
}
