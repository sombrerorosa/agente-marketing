import { Buffer } from "node:buffer";
import { webcrypto } from "node:crypto";
import type { BigQueryEnv } from "./types.js";

// nodejs_compat (set in wrangler.toml) makes node:buffer / node:crypto
// available inside the Worker too, so this file runs unmodified there and
// in the local backfill script (plain Node).
const subtle = webcrypto.subtle;

let cachedToken: { token: string; expiresAt: number } | null = null;

function base64UrlEncode(data: ArrayBuffer | Uint8Array): string {
  const buf = Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data));
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const normalized = pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
  const base64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const buf = Buffer.from(base64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function signJwt(env: BigQueryEnv): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: env.GCP_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/bigquery",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encoder = new TextEncoder();
  const signingInput = `${base64UrlEncode(encoder.encode(JSON.stringify(header)))}.${base64UrlEncode(
    encoder.encode(JSON.stringify(claims))
  )}`;

  const key = await subtle.importKey(
    "pkcs8",
    pemToDer(env.GCP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(signingInput));

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/** Two-legged service-account OAuth2 flow — no google-auth-library, since it doesn't run on Workers. */
async function getAccessToken(env: BigQueryEnv): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;

  const assertion = await signJwt(env);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to obtain BigQuery access token: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.token;
}

export interface QueryParameter {
  name: string;
  parameterType: Record<string, unknown>;
  parameterValue: Record<string, unknown>;
}

/** Runs a parameterized query/DML statement via the BigQuery REST API (jobs.query). */
export async function runQuery(env: BigQueryEnv, query: string, parameters: QueryParameter[] = []): Promise<void> {
  const token = await getAccessToken(env);
  const response = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${env.GCP_PROJECT_ID}/queries`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      useLegacySql: false,
      parameterMode: "NAMED",
      queryParameters: parameters,
      timeoutMs: 60000,
    }),
  });

  if (!response.ok) {
    throw new Error(`BigQuery query failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { jobComplete?: boolean };
  if (!body.jobComplete) {
    throw new Error("BigQuery query did not complete within the timeout — the range being synced may be too large for one call.");
  }
}
