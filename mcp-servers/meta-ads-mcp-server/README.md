# meta-ads-mcp-server

MCP server for the Meta Marketing API (Facebook/Instagram Ads): campaigns, ad
sets, ads, creatives, audiences, and insights reporting for a single ad
account.

## Setup

### 1. Business Manager access

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

### 2. Environment variables

Copy `.env.example` to `.env` (or set these in whatever process manager
launches the server):

- `META_ACCESS_TOKEN` — the System User token from step 1
- `META_AD_ACCOUNT_ID` — with or without the `act_` prefix
- `GRAPH_API_VERSION` — optional, defaults to `v21.0`

### 3. Install and build

```bash
npm install
npm run build
```

### 4. Register with an MCP client

Example for a client that reads a JSON config of MCP servers (adjust to your
client's format):

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

## Tools

| Tool | Description |
|---|---|
| `meta_ads_list_campaigns` / `get` / `create` / `update` / `delete` | Campaign CRUD |
| `meta_ads_list_adsets` / `get` / `create` / `update` / `delete` | Ad set CRUD (targeting, budget, optimization goal) |
| `meta_ads_list_ads` / `get` / `create` / `update` / `delete` | Ad CRUD (links an ad set to a creative) |
| `meta_ads_upload_image` / `meta_ads_upload_video` | Upload media, returns `image_hash` / `video_id` |
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
- **Large video uploads**: `meta_ads_upload_video` uses a direct (non-chunked)
  upload. It works well for typical ad-length videos but isn't the resumable
  upload API Meta recommends for very large files (~1GB+).
- **Rate limiting**: the client backs off automatically on Meta's throttling
  errors (codes 4/17/32/613) with exponential backoff, up to 3 retries, and
  logs a warning to stderr when usage-header percentages exceed 90%.

## Development

```bash
npm run dev     # watch mode
npm run build   # compile to dist/
npx @modelcontextprotocol/inspector node dist/index.js   # interactive testing
```
