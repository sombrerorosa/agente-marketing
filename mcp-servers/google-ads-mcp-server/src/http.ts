#!/usr/bin/env node
/**
 * Plain-Node Streamable HTTP entry point — for running this MCP server on
 * your own infrastructure (no Cloudflare, no git hosting), reachable by
 * multiple people/tools over your internal network. Same tool logic as
 * src/index.ts (stdio) and src/worker.ts (Cloudflare Workers).
 *
 * This process has no built-in authentication — anyone who can reach it on
 * the network can create/edit/delete real campaigns and spend real budget.
 * Put it behind your own network ACL, VPN, or reverse-proxy auth before
 * exposing it beyond localhost.
 */

import { config as loadDotenv } from "dotenv";
loadDotenv();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAdGroupTools } from "./tools/adgroups.js";
import { registerAdTools } from "./tools/ads.js";
import { registerAudienceTools } from "./tools/audiences.js";
import { registerCampaignTools } from "./tools/campaigns.js";
import { registerInsightTools } from "./tools/insights.js";
import { registerKeywordTools } from "./tools/keywords.js";
import { registerSchedulingTools } from "./tools/scheduling.js";
import { registerUtilityTools } from "./tools/utility.js";

function validateEnvironment(): void {
  const missing = ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_CUSTOMER_ID"].filter(
    (key) => !process.env[key]
  );
  if (missing.length) {
    console.error(`ERROR: missing required environment variable(s): ${missing.join(", ")}`);
    console.error("Set them in a .env file next to this process, or as real environment variables. See .env.example.");
    process.exit(1);
  }
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "google-ads-mcp-server", version: "1.0.0" });
  registerCampaignTools(server);
  registerAdGroupTools(server);
  registerAdTools(server);
  registerKeywordTools(server);
  registerAudienceTools(server);
  registerInsightTools(server);
  registerSchedulingTools(server);
  registerUtilityTools(server);
  return server;
}

validateEnvironment();

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;

// allowedHosts must list every Host header value clients will actually send
// (hostname, hostname:port, and any internal DNS alias) — the SDK rejects
// anything not on this list to block DNS-rebinding attacks. HOST=0.0.0.0
// gets no automatic protection, so set this explicitly once you know your
// internal hostname (or ALLOWED_HOSTS=host1,host2 to override at runtime).
const allowedHosts = process.env.ALLOWED_HOSTS?.split(",").map((h) => h.trim()).filter(Boolean);
const app = createMcpExpressApp({ host: HOST, ...(allowedHosts?.length ? { allowedHosts } : {}) });

// A fresh McpServer per request, not one built at module scope and reused —
// StreamableHTTPServerTransport throws if you .connect() a server that's
// already connected, which bites on the second request to a shared instance.
// See worker.ts for the same fix applied to the Cloudflare entry point.
app.post("/mcp", async (req, res) => {
  const server = buildServer();
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

// Streamable HTTP is POST-only for this stateless setup (no server-initiated
// notifications over a long-lived GET stream, no session to DELETE).
app.get("/mcp", (_req, res) => {
  res.writeHead(405).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
});
app.delete("/mcp", (_req, res) => {
  res.writeHead(405).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
});

app.listen(PORT, HOST, () => {
  console.error(`google-ads-mcp-server listening on http://${HOST}:${PORT}/mcp`);
});
