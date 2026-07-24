# meta-ads-mcp-server

MCP server for the Meta Marketing API (Facebook/Instagram Ads): campaigns, ad
sets, ads, creatives, audiences, and insights reporting for a single ad
account.

Two ways to run it, same tool logic underneath:

- **`src/index.ts`** — stdio entry point, for a local MCP client (Claude
  Desktop, a CLI, etc.) that launches the server as a subprocess.
- **`src/worker.ts`** — Cloudflare Workers entry point (Streamable HTTP), for
  a hosted deployment reachable over HTTPS — no local install needed. This is
  the recommended path if you don't run an MCP client locally.

Media uploads (`meta_ads_upload_image` / `meta_ads_upload_video`) only accept
public HTTPS URLs, not local file paths — this keeps the tool logic identical
on both entry points (the Worker has no local filesystem) and matches how
Meta recommends uploading anyway (it fetches the URL server-side). Point it at
a hosted export from Canva, Higgsfield, or wherever the creative was produced.

## 1. Business Manager access

This server authenticates as a **Business Manager System User**, not via
interactive OAuth login — it's meant to run unattended.

1. **Business Settings → Users → System Users** — create a System User (or
   reuse one), role Admin or Employee.
2. **Business Settings → Accounts → Ad Accounts** — assign the ad account to
   that System User with the "Manage campaigns" (or Advertiser) task.
3. **Business Settings → Accounts → Pages** — assign the Page(s) you'll use
   in ad creatives to the same System User.
4. On the System User, **Generate New Token** for your app with scopes:
   `ads_management`, `ads_read`, `business_management`, `pages_show_list`,
   `pages_read_engagement`, `read_insights`. Set expiration to **Never**.
5. Verify it: `curl "https://graph.facebook.com/v21.0/act_<AD_ACCOUNT_ID>?fields=name&access_token=<TOKEN>"`

**Never commit real values for `META_ACCESS_TOKEN` / `META_AD_ACCOUNT_ID`
anywhere in this repo** (README included — it's version-controlled and
visible to anyone with repo access). Secrets belong only in your local
`.env` / `.dev.vars` (both gitignored) or in your deployment platform's own
secret store. If a real token ever ends up in a commit, treat it as
compromised and regenerate it in Business Manager immediately — removing it
in a later commit does not remove it from git history.

## 2a. Run locally (stdio)

```bash
npm install
npm run build
```

Copy `.env.example` to `.env` and fill in `META_ACCESS_TOKEN` /
`META_AD_ACCOUNT_ID`, then register it with your MCP client:

```json
{
  "mcpServers": {
    "meta-ads": {
      "command": "node",
      "args": ["/absolute/path/to/meta-ads-mcp-server/dist/index.js"],
      "env": {
        "META_ACCESS_TOKEN": "...",
        "META_AD_ACCOUNT_ID": "..."
      }
    }
  }
}
```

## 2b. Deploy to Cloudflare Workers (no install needed)

This path uses Cloudflare's dashboard to connect this GitHub repo directly —
no CLI, no local Node install. It redeploys automatically on every push.

1. Go to **dash.cloudflare.com → Workers & Pages → Create → Connect to Git**.
2. Pick this repository and set the **root directory** to
   `mcp-servers/meta-ads-mcp-server`.
3. Build settings: Cloudflare auto-detects `wrangler.toml` — no build command
   needed (Wrangler bundles `src/worker.ts` directly).
4. Before the first deploy (or right after, then redeploy), go to the
   Worker's **Settings → Variables and Secrets** and add, as **Secrets**
   (encrypted, not plain vars):
   - `META_ACCESS_TOKEN`
   - `META_AD_ACCOUNT_ID`
5. Deploy. Cloudflare gives you a URL like
   `https://meta-ads-mcp-server.<your-subdomain>.workers.dev`. The MCP
   endpoint is that URL + `/mcp`.
6. Add it as a custom connector wherever you want to use it (e.g. claude.ai
   → Settings → Connectors → Add custom connector), pointing at the `/mcp`
   URL.

To test the bundle locally without deploying (no Cloudflare account/network
needed — this only runs esbuild):

```bash
npm install
npx wrangler deploy --dry-run --outdir /tmp/out
```

## Tools

| Tool | Description |
|---|---|
| `meta_ads_list_campaigns` / `get` / `create` / `update` / `delete` | Campaign CRUD |
| `meta_ads_list_adsets` / `get` / `create` / `update` / `delete` | Ad set CRUD (targeting, budget, optimization goal) |
| `meta_ads_list_ads` / `get` / `create` / `update` / `delete` | Ad CRUD (links an ad set to a creative) |
| `meta_ads_upload_image` / `meta_ads_upload_video` | Upload media from a public URL, returns `image_hash` / `video_id` |
| `meta_ads_create_ad_creative` / `list` / `get` | Build the copy + media + destination + CTA used by an ad |
| `meta_ads_create_custom_audience` / `meta_ads_create_lookalike_audience` / `list_audiences` / `delete_audience` | Audience management |
| `meta_ads_get_insights` | Performance metrics (spend, CTR, CPA, ROAS, etc.) by campaign/ad set/ad and date range |
| `meta_ads_get_ad_account` / `meta_ads_list_pages` | Account status and available Pages |

All write/update/delete tools default new campaigns and ad sets to
`status=PAUSED` so nothing spends until explicitly activated.

## Known limitations (v1)

- **No PII audience upload**: `meta_ads_create_custom_audience` creates an
  empty audience shell. Uploading member lists (emails/phones) requires
  SHA-256 hashing PII before sending it to Meta — deliberately left out of
  this version; ask for it explicitly if needed.
- **URL-only media upload**: no local file upload, only public HTTPS URLs
  (see the note at the top of this file for why).
- **Large video uploads**: `meta_ads_upload_video` uses a direct (non-chunked)
  upload. It works well for typical ad-length videos but isn't the resumable
  upload API Meta recommends for very large files (~1GB+).
- **Rate limiting**: the client backs off automatically on Meta's throttling
  errors (codes 4/17/32/613) with exponential backoff, up to 3 retries, and
  logs a warning to stderr when usage-header percentages exceed 90%.

## Development

```bash
npm run dev              # watch mode, stdio entry point
npm run build             # compile src/index.ts (Node) to dist/
npm run typecheck:worker  # typecheck src/worker.ts against Workers types
npx @modelcontextprotocol/inspector node dist/index.js   # interactive testing, stdio
npm run worker:dev        # local Cloudflare Worker dev server (wrangler dev)
```
