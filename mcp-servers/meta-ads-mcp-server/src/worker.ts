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

    // A fresh McpServer per request, not one built at module scope and
    // reused — createMcpHandler's stateless mode throws ("Server is
    // already connected to a transport") the second time a request reaches
    // an isolate that already handled one, since .connect() was already
    // called on a reused instance. This is almost certainly what caused
    // the earlier "same server error on every retry" incident: the first
    // request to a freshly (re)started isolate worked, every later request
    // to that same hot isolate threw. Registering ~20 tools is cheap (sync
    // closures, no I/O), so paying that cost per request is the right
    // trade for correctness here.
    const server = buildServer();
    const handleMcpRequest = createMcpHandler(server, { route: "/mcp", enableJsonResponse: true });
    return handleMcpRequest(request, env, ctx);
  },
};
