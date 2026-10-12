# google-ads-mcp-server

MCP server for the Google Ads API: campaigns, ad groups, ads (Responsive
Search Ads), keywords, Customer Match audiences, and performance reporting
for a single customer account.

Two ways to run it, same tool logic underneath:

- **`src/index.ts`** — stdio entry point, for a local MCP client (Claude
  Desktop, a CLI, etc.) that launches the server as a subprocess.
- **`src/worker.ts`** — Cloudflare Workers entry point (Streamable HTTP), for
  a hosted deployment reachable over HTTPS — no local install needed. This is
  the recommended path if you don't run an MCP client locally.

It talks to the Google Ads REST API directly over `fetch` (GAQL `search` for
reads, `:mutate` for writes) rather than through Google's own gRPC client
libraries, so the same code runs unmodified on Node and on Cloudflare
Workers (which can't do raw gRPC).

## 1. Get Google Ads API access

Google changed how this works in September 2026: **the developer token no
longer gates access** — it's retired as the thing Google checks. Access
level (Test / Basic / Standard) now attaches to the **Google Cloud project**
that issues your OAuth credentials instead. This server still has a
`GOOGLE_ADS_DEVELOPER_TOKEN` env var for backward compatibility (the API
still accepts the header, it just ignores it), but you don't need one to get
started. Verify this is still current at
[developers.google.com/google-ads/api/docs/api-policy/access-levels](https://developers.google.com/google-ads/api/docs/api-policy/access-levels)
before relying on it — Google's own cached docs pages were still describing
the old developer-token-gated model as of mid-2026.

1. **Create or pick a Google Cloud project** at
   [console.cloud.google.com](https://console.cloud.google.com) — any
   project you control works, it doesn't need to be new.
2. **Enable the Google Ads API** for that project (APIs & Services >
   Library > search "Google Ads API" > Enable).
3. **Configure the OAuth consent screen** (APIs & Services > OAuth consent
   screen) if you haven't already for this project. Internal/External
   doesn't matter much for a single-account unattended integration like this
   one.
4. **Create an OAuth Client ID** (APIs & Services > Credentials > Create
   Credentials > OAuth client ID). Choose **Desktop app** as the type — it's
   the simplest to generate a refresh token with (no redirect URI hosting
   needed). Note the Client ID and Client Secret.
5. **Apply for API access level** on this same Cloud project: open the
   Google Ads API Overview page (linked from Google Ads UI > Tools & Settings
   > Setup > API Center, or directly in Cloud Console under this project's
   Google Ads API page), expand "Upgrade access level", and apply for
   **Basic**. New applications require brand verification first — follow the
   prompt if you see one. Basic covers test *and* production accounts with a
   15,000-operations-per-day cap, which is plenty to start; apply for
   Standard later only if you outgrow that.
6. **Generate a refresh token** for the Google account that has access to
   the ad account you'll manage. The quickest way without writing a script:
   [Google's OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
   — click the gear icon, check "Use your own OAuth credentials", paste your
   Client ID/Secret from step 4, then in Step 1 authorize the scope
   `https://www.googleapis.com/auth/adwords`, sign in as the right Google
   account, and in Step 2 exchange the authorization code for tokens. Copy
   the **refresh_token** — it doesn't expire unless revoked.
7. **Find your Customer ID.** If you already know it (it's the number shown
   top-right in the Google Ads UI, e.g. `123-456-7890`), strip the dashes.
   Otherwise, fill in just the client ID/secret/refresh token below, run
   the server, and call `google_ads_list_accessible_customers` — it works
   without `GOOGLE_ADS_CUSTOMER_ID` set.
8. **If the target account is managed through an MCC (manager) account**
   and your OAuth user logs in at the MCC level rather than directly on the
   client account, also set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to the MCC's
   Customer ID (digits only). Omit it if you authenticate directly against
   the target account.

**Never commit real values for any of these env vars anywhere in this repo**
(README included). Secrets belong only in your local `.env` / `.dev.vars`
(both gitignored) or in your deployment platform's own secret store. If a
real credential ever ends up in a commit, treat it as compromised —
regenerate the OAuth client secret / refresh token immediately; removing it
in a later commit does not remove it from git history.

## 2a. Run locally (stdio)

```bash
npm install
npm run build
```

Copy `.env.example` to `.env` and fill it in, then register it with your MCP
client:

```json
{
  "mcpServers": {
    "google-ads": {
      "command": "node",
      "args": ["/absolute/path/to/google-ads-mcp-server/dist/index.js"],
      "env": {
        "GOOGLE_ADS_CLIENT_ID": "...",
        "GOOGLE_ADS_CLIENT_SECRET": "...",
        "GOOGLE_ADS_REFRESH_TOKEN": "...",
        "GOOGLE_ADS_CUSTOMER_ID": "..."
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
   `mcp-servers/google-ads-mcp-server`.
3. Build settings: Cloudflare auto-detects `wrangler.toml` — no build command
   needed (Wrangler bundles `src/worker.ts` directly).
4. Before the first deploy (or right after, then redeploy), go to the
   Worker's **Settings → Variables and Secrets** and add, as **Secrets**
   (encrypted, not plain vars): `GOOGLE_ADS_CLIENT_ID`,
   `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`,
   `GOOGLE_ADS_CUSTOMER_ID`, and `GOOGLE_ADS_LOGIN_CUSTOMER_ID` /
   `GOOGLE_ADS_DEVELOPER_TOKEN` if you need them.
5. Deploy. Cloudflare gives you a URL like
   `https://google-ads-mcp-server.<your-subdomain>.workers.dev`. The MCP
   endpoint is that URL + `/mcp`.
6. Add it as a custom connector wherever you want to use it (e.g. claude.ai
   → Settings → Connectors → Add custom connector), pointing at the `/mcp`
   URL. Pick a distinct Worker name from any other MCP server you've already
   deployed in this repo (e.g. the Meta Ads one) — each needs its own URL.

To test the bundle locally without deploying (no Cloudflare account/network
needed — this only runs esbuild):

```bash
npm install
npx wrangler deploy --dry-run --outdir /tmp/out
```

## Tools

Every tool takes an optional `customer_id` that overrides
`GOOGLE_ADS_CUSTOMER_ID` for that one call — an agency managing several
client accounts under the same OAuth login (or the same MCC) doesn't need a
separate deployment per client. Use `google_ads_list_accessible_customers`
to find the Customer IDs the configured credentials can reach, and
`google_ads_get_customer` with `customer_id` set to check which one belongs
to which client by name.

**Campaigns** — `google_ads_list_campaigns`, `google_ads_get_campaign`,
`google_ads_create_campaign`, `google_ads_update_campaign`,
`google_ads_delete_campaign`. Google always budgets at the campaign level
(via an auto-created `CampaignBudget` resource) — there's no per-ad-group
budget option the way some other platforms have.

**Ad groups** — `google_ads_list_ad_groups`, `google_ads_get_ad_group`,
`google_ads_create_ad_group`, `google_ads_update_ad_group`,
`google_ads_delete_ad_group`. No inline targeting — that's attached
separately via the keyword/audience tools below.

**Ads** — `google_ads_list_ads`, `google_ads_get_ad`, `google_ads_create_ad`
(Responsive Search Ads only), `google_ads_update_ad` (status only — ad copy
is immutable once created), `google_ads_delete_ad`.

**Keywords** — `google_ads_add_keywords`, `google_ads_list_keywords`,
`google_ads_remove_keyword`, `google_ads_add_campaign_negative_keywords`.

**Audiences** — `google_ads_create_customer_match_list`,
`google_ads_list_user_lists`, `google_ads_get_user_list`,
`google_ads_delete_user_list`.

**Insights** — `google_ads_get_insights`: GAQL-backed performance reporting
at the account/campaign/ad-group/ad level.

**Ad schedule (dayparting)** — `google_ads_add_campaign_ad_schedule`,
`google_ads_list_campaign_ad_schedule`,
`google_ads_remove_campaign_ad_schedule`. Restrict or exclude the hours/days
a campaign serves in.

**Utility** — `google_ads_get_customer`, `google_ads_list_accessible_customers`.

## Known limitations (v1 scope)

- **No Customer Match member upload.** `google_ads_create_customer_match_list`
  creates the empty audience resource; uploading the actual hashed
  emails/phones requires Google's `OfflineUserDataJobService`, which isn't
  wired up here yet. Upload members via Audience Manager in the Google Ads
  UI after creating the list.
- **No "lookalike" / Similar Audiences equivalent.** Google retired Similar
  Audiences in 2023 in favor of automatic audience expansion (optimized
  targeting), which doesn't need a manageable audience resource.
- **Ad types: Responsive Search Ads only.** Display, Performance Max, Demand
  Gen, and video ads need asset groups built in the Ads Manager UI for now.
- **Ad copy is immutable once created.** `google_ads_update_ad` only flips
  status; to change headlines/descriptions, delete the ad and create a new
  one.
