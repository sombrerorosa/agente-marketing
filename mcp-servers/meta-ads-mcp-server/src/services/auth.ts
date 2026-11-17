/**
 * Access control for the Cloudflare Worker entry point.
 *
 * The Worker holds credentials that can spend money and publish content, so
 * every request must present the shared secret configured as the
 * MCP_AUTH_TOKEN Worker secret. Two ways to present it:
 *
 *   1. `Authorization: Bearer <token>` — preferred, for clients that can
 *      send custom headers.
 *   2. As a path segment, `/mcp/<token>` — for clients that only accept a
 *      URL (e.g. a custom connector with no header configuration). The
 *      segment is stripped before the request reaches the MCP handler.
 *
 * Fails closed: with no MCP_AUTH_TOKEN configured, nothing is served.
 */

const MCP_ROUTE = "/mcp";
const MIN_TOKEN_LENGTH = 32;

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

/** Compares digests rather than raw strings so timing doesn't leak length or prefix. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

function deny(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(status === 401 ? { "WWW-Authenticate": 'Bearer realm="mcp"' } : {}),
    },
  });
}

export type AuthResult = { ok: true; request: Request } | { ok: false; response: Response };

/**
 * Returns the request to hand to the MCP handler (with any path token
 * removed), or the response to send back when the caller isn't authorized.
 */
export async function authorize(request: Request, expectedToken: string | undefined): Promise<AuthResult> {
  if (!expectedToken || expectedToken.length < MIN_TOKEN_LENGTH) {
    return {
      ok: false,
      response: deny(503, `Server is not configured: set the MCP_AUTH_TOKEN secret (at least ${MIN_TOKEN_LENGTH} characters).`),
    };
  }

  const header = request.headers.get("Authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (bearer) {
    return (await safeEqual(bearer, expectedToken)) ? { ok: true, request } : { ok: false, response: deny(401, "Unauthorized") };
  }

  const url = new URL(request.url);
  const prefix = `${MCP_ROUTE}/`;
  if (url.pathname.startsWith(prefix)) {
    let pathToken = url.pathname.slice(prefix.length);
    try {
      pathToken = decodeURIComponent(pathToken);
    } catch {
      return { ok: false, response: deny(401, "Unauthorized") };
    }
    if (pathToken && (await safeEqual(pathToken, expectedToken))) {
      url.pathname = MCP_ROUTE;
      return { ok: true, request: new Request(url.toString(), request) };
    }
  }

  return { ok: false, response: deny(401, "Unauthorized") };
}
