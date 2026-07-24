#!/usr/bin/env node
/**
 * MCP server for the Meta Marketing API (Facebook/Instagram Ads).
 *
 * Covers campaign/ad set/ad CRUD, creative upload, audience management, and
 * insights reporting for a single ad account, authenticated via a Business
 * Manager System User token (see README.md for setup).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAdSetTools } from "./tools/adsets.js";
import { registerAdTools } from "./tools/ads.js";
import { registerAudienceTools } from "./tools/audiences.js";
import { registerCampaignTools } from "./tools/campaigns.js";
import { registerCreativeTools } from "./tools/creatives.js";
import { registerInsightTools } from "./tools/insights.js";
import { registerUtilityTools } from "./tools/utility.js";

function validateEnvironment(): void {
  const missing = ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"].filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`ERROR: missing required environment variable(s): ${missing.join(", ")}`);
    console.error("See .env.example for setup instructions.");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  validateEnvironment();

  const server = new McpServer({
    name: "meta-ads-mcp-server",
    version: "1.0.0",
  });

  registerCampaignTools(server);
  registerAdSetTools(server);
  registerAdTools(server);
  registerCreativeTools(server);
  registerAudienceTools(server);
  registerInsightTools(server);
  registerUtilityTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("meta-ads-mcp-server running via stdio");
}

main().catch((error) => {
  console.error("Fatal error starting meta-ads-mcp-server:", error);
  process.exit(1);
});
