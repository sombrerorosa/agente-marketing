import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GetCustomerInput, GetCustomerInputSchema, ListAccessibleCustomersInput, ListAccessibleCustomersInputSchema } from "../schemas/utility.js";
import { handleGoogleAdsError } from "../services/errorHandler.js";
import { buildResponse, errorResponse } from "../services/formatting.js";
import { listAccessibleCustomers, searchOne } from "../services/googleAdsClient.js";

export function registerUtilityTools(server: McpServer): void {
  server.registerTool(
    "google_ads_get_customer",
    {
      title: "Get Google Ads Customer Account",
      description: `Fetch descriptive info for the configured customer account (GOOGLE_ADS_CUSTOMER_ID). Useful as a first call to confirm the OAuth/credential setup is working.

Read-only. No arguments besides response_format.

Returns id, descriptive_name, currency_code, time_zone, and whether this account is itself a manager (MCC) account.

Error Handling:
  - "Permission denied" if this OAuth user doesn't have access to GOOGLE_ADS_CUSTOMER_ID, or GOOGLE_ADS_LOGIN_CUSTOMER_ID is missing/wrong for a client account under an MCC
  - "OAuth access token rejected" if GOOGLE_ADS_REFRESH_TOKEN needs to be regenerated`,
      inputSchema: GetCustomerInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: GetCustomerInput) => {
      try {
        const row = await searchOne(
          "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer"
        );
        if (!row) return errorResponse("Error: Could not fetch the configured customer account.");
        const c = row.customer as Record<string, unknown>;
        const markdown = [
          `## ${c.descriptiveName ?? "(no name set)"} (\`${c.id}\`)`,
          `- **Currency**: ${c.currencyCode}`,
          `- **Time zone**: ${c.timeZone}`,
          `- **Manager (MCC) account**: ${c.manager ? "yes" : "no"}`,
        ].join("\n");
        return buildResponse(c, markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_list_accessible_customers",
    {
      title: "List Accessible Google Ads Customers",
      description: `List every Customer ID the configured OAuth credentials (GOOGLE_ADS_REFRESH_TOKEN) can access. Doesn't require GOOGLE_ADS_CUSTOMER_ID to be set — useful during setup, to find the right value for it before configuring the rest of the server.

Read-only. No arguments besides response_format.

Returns a flat list of Customer IDs (digits only). If a manager (MCC) account is in the list, the accounts it manages aren't expanded here — run google_ads_get_customer against each ID (with GOOGLE_ADS_LOGIN_CUSTOMER_ID set to the MCC) to tell manager accounts from client accounts.`,
      inputSchema: ListAccessibleCustomersInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ListAccessibleCustomersInput) => {
      try {
        const ids = await listAccessibleCustomers();
        if (!ids.length) {
          return { content: [{ type: "text" as const, text: "No accessible customers found for this OAuth user." }] };
        }
        const markdown = [`# Accessible Customers (${ids.length})`, "", ...ids.map((id) => `- \`${id}\``)].join("\n");
        return buildResponse({ customer_ids: ids }, markdown, params.response_format);
      } catch (error) {
        return errorResponse(handleGoogleAdsError(error));
      }
    }
  );
}
