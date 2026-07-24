/**
 * Cloudflare Workers entry point. Same tool logic as src/index.ts (the
 * stdio/Node entry point) exposed over Streamable HTTP instead, via
 * Cloudflare's `agents` package. Stateless — no Durable Object session
 * required, matching the account's single-ad-account, no-per-user-state
 * shape of this server.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { registerAdSetTools } from "./tools/adsets.js";
import { registerAdTools } from "./tools/ads.js";
import { registerAudienceTools } from "./tools/audiences.js";
import { registerCampaignTools } from "./tools/campaigns.js";
import { registerCreativeTools } from "./tools/creatives.js";
import { registerInsightTools } from "./tools/insights.js";
import { registerUtilityTools } from "./tools/utility.js";

interface Env {
  META_ACCESS_TOKEN: string;
  META_AD_ACCOUNT_ID: string;
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "meta-ads-mcp-server", version: "1.0.0" });
  registerCampaignTools(server);
  registerAdSetTools(server);
  registerAdTools(server);
  registerCreativeTools(server);
  registerAudienceTools(server);
  registerInsightTools(server);
  registerUtilityTools(server);
  return server;
}

// Built once per isolate and reused across requests handled by that isolate.
const server = buildServer();
const handleMcpRequest = createMcpHandler(server, { route: "/mcp", enableJsonResponse: true });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!env.META_ACCESS_TOKEN || !env.META_AD_ACCOUNT_ID) {
      return new Response(
        "Missing META_ACCESS_TOKEN or META_AD_ACCOUNT_ID. Set them as Secrets in the Worker's Settings > Variables and Secrets.",
        { status: 500 }
      );
    }
    // The shared tool logic (services/graphApiClient.ts) reads credentials
    // from process.env for parity with the Node/stdio entry point — bridge
    // the Worker's env bindings into it explicitly rather than relying on
    // any particular nodejs_compat auto-population behavior.
    process.env.META_ACCESS_TOKEN = env.META_ACCESS_TOKEN;
    process.env.META_AD_ACCOUNT_ID = env.META_AD_ACCOUNT_ID;

    return handleMcpRequest(request, env, ctx);
  },
};
