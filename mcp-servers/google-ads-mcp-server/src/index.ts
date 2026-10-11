#!/usr/bin/env node
/**
 * MCP server for the Google Ads API.
 *
 * Covers campaign/ad group/ad/keyword CRUD, Customer Match audience
 * management, and performance reporting for a single customer account,
 * authenticated via OAuth2 (see README.md for setup).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAdGroupTools } from "./tools/adgroups.js";
import { registerAdTools } from "./tools/ads.js";
import { registerAudienceTools } from "./tools/audiences.js";
import { registerCampaignTools } from "./tools/campaigns.js";
import { registerInsightTools } from "./tools/insights.js";
import { registerKeywordTools } from "./tools/keywords.js";
import { registerUtilityTools } from "./tools/utility.js";

function validateEnvironment(): void {
  const missing = ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_CUSTOMER_ID"].filter(
    (key) => !process.env[key]
  );
  if (missing.length) {
    console.error(`ERROR: missing required environment variable(s): ${missing.join(", ")}`);
    console.error("See .env.example for setup instructions.");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  validateEnvironment();

  const server = new McpServer({
    name: "google-ads-mcp-server",
    version: "1.0.0",
  });

  registerCampaignTools(server);
  registerAdGroupTools(server);
  registerAdTools(server);
  registerKeywordTools(server);
  registerAudienceTools(server);
  registerInsightTools(server);
  registerUtilityTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("google-ads-mcp-server running via stdio");
}

main().catch((error) => {
  console.error("Fatal error starting google-ads-mcp-server:", error);
  process.exit(1);
});
