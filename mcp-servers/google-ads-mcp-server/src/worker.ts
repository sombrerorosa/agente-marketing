/**
 * Cloudflare Workers entry point. Same tool logic as src/index.ts (the
 * stdio/Node entry point) exposed over Streamable HTTP instead, via
 * Cloudflare's `agents` package. Stateless — no Durable Object session
 * required, matching the account's single-customer, no-per-user-state
 * shape of this server.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { registerAdGroupTools } from "./tools/adgroups.js";
import { registerAdTools } from "./tools/ads.js";
import { registerAudienceTools } from "./tools/audiences.js";
import { registerCampaignTools } from "./tools/campaigns.js";
import { registerInsightTools } from "./tools/insights.js";
import { registerKeywordTools } from "./tools/keywords.js";
import { registerUtilityTools } from "./tools/utility.js";

interface Env {
  GOOGLE_ADS_CLIENT_ID: string;
  GOOGLE_ADS_CLIENT_SECRET: string;
  GOOGLE_ADS_REFRESH_TOKEN: string;
  GOOGLE_ADS_CUSTOMER_ID: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
  GOOGLE_ADS_DEVELOPER_TOKEN?: string;
}

const REQUIRED_ENV_KEYS = ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_CUSTOMER_ID"] as const;

function buildServer(): McpServer {
  const server = new McpServer({ name: "google-ads-mcp-server", version: "1.0.0" });
  registerCampaignTools(server);
  registerAdGroupTools(server);
  registerAdTools(server);
  registerKeywordTools(server);
  registerAudienceTools(server);
  registerInsightTools(server);
  registerUtilityTools(server);
  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const missing = REQUIRED_ENV_KEYS.filter((key) => !env[key]);
    if (missing.length) {
      return new Response(
        `Missing ${missing.join(", ")}. Set them as Secrets in the Worker's Settings > Variables and Secrets.`,
        { status: 500 }
      );
    }
    // The shared tool logic (services/googleAdsClient.ts) reads credentials
    // from process.env for parity with the Node/stdio entry point — bridge
    // the Worker's env bindings into it explicitly rather than relying on
    // any particular nodejs_compat auto-population behavior.
    process.env.GOOGLE_ADS_CLIENT_ID = env.GOOGLE_ADS_CLIENT_ID;
    process.env.GOOGLE_ADS_CLIENT_SECRET = env.GOOGLE_ADS_CLIENT_SECRET;
    process.env.GOOGLE_ADS_REFRESH_TOKEN = env.GOOGLE_ADS_REFRESH_TOKEN;
    process.env.GOOGLE_ADS_CUSTOMER_ID = env.GOOGLE_ADS_CUSTOMER_ID;
    if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    if (env.GOOGLE_ADS_DEVELOPER_TOKEN) process.env.GOOGLE_ADS_DEVELOPER_TOKEN = env.GOOGLE_ADS_DEVELOPER_TOKEN;

    // A fresh McpServer per request, not one built at module scope and
    // reused — createMcpHandler's stateless mode throws
    // ("Server is already connected to a transport") the second time a
    // request reaches an isolate that already handled one, since .connect()
    // was already called on a reused instance. Registering ~25 tools is
    // cheap (sync closures, no I/O), so paying that cost per request is the
    // right trade for correctness here.
    const server = buildServer();
    const handleMcpRequest = createMcpHandler(server, { route: "/mcp", enableJsonResponse: true });
    return handleMcpRequest(request, env, ctx);
  },
};
