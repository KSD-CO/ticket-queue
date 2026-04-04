// ============================================================
// Gateway — token verification, proxy, and queue redirect
//
// Decision tree:
//   Request ──▶ has token cookie?
//     ├── YES ──▶ verify token
//     │   ├── valid ──▶ proxy to origin
//     │   ├── expired (within grace) ──▶ proxy to origin
//     │   ├── expired (past grace) ──▶ redirect to queue
//     │   └── malformed/bad sig ──▶ redirect to queue
//     └── NO ──▶ match protected path?
//         ├── YES ──▶ redirect to queue page
//         └── NO ──▶ pass through (not protected)
//
// Fail-open: if DO or KV is unreachable, proxy to origin anyway
// ============================================================

import type { Context } from "hono";
import { verifyToken } from "../shared/jwt.js";
import {
  TOKEN_COOKIE_NAME,
  TOKEN_GRACE_PERIOD_SECONDS,
  EVENT_CONFIG_PREFIX,
  SIGNING_KEY_PREFIX,
  PATH_INDEX_KEY,
} from "../shared/constants.js";
import { TokenExpiredError } from "../shared/errors.js";
import type { EventConfig } from "../shared/config.js";

interface GatewayEnv {
  CONFIG_KV: KVNamespace;
  QUEUE_DO: DurableObjectNamespace;
}

/** Parse a specific cookie value from Cookie header */
function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return null;
}

/** Find matching event config for the request path */
async function findEventForPath(
  path: string,
  kv: KVNamespace,
): Promise<EventConfig | null> {
  // Read the path→eventId index (single KV.get, no KV.list)
  const raw = await kv.get(PATH_INDEX_KEY);
  if (!raw) return null;

  let pathMap: Record<string, string>;
  try {
    pathMap = JSON.parse(raw) as Record<string, string>;
  } catch {
    return null;
  }

  // Find the first matching path pattern
  let matchedEventId: string | null = null;
  for (const [pattern, eventId] of Object.entries(pathMap)) {
    if (matchPath(path, pattern)) {
      matchedEventId = eventId;
      break;
    }
  }

  if (!matchedEventId) return null;

  // Fetch the full event config (single KV.get)
  const configRaw = await kv.get(`${EVENT_CONFIG_PREFIX}${matchedEventId}`);
  if (!configRaw) return null;

  try {
    const config = JSON.parse(configRaw) as EventConfig;
    if (!config.enabled) return null;
    return config;
  } catch {
    return null;
  }
}

/** Simple path matching with wildcard support */
function matchPath(path: string, pattern: string): boolean {
  if (pattern === path) return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return path === prefix || path.startsWith(prefix + "/");
  }
  if (pattern.endsWith("*")) {
    return path.startsWith(pattern.slice(0, -1));
  }
  return false;
}

/** Main gateway handler */
export async function handleGateway(
  c: Context<{ Bindings: GatewayEnv }>,
): Promise<Response> {
  const request = c.req.raw;
  const url = new URL(request.url);
  const path = url.pathname;

  // Guard: never redirect queue paths back to the queue (prevent redirect loop)
  if (path === "/queue" || path.startsWith("/queue/")) {
    return fetch(request);
  }

  // Step 1: Check for existing token cookie
  const token = getCookie(request, TOKEN_COOKIE_NAME);
  if (token) {
    return handleWithToken(c, request, token, path);
  }

  // Step 2: No token — check if this path is protected
  return handleWithoutToken(c, request, path);
}

async function handleWithToken(
  c: Context<{ Bindings: GatewayEnv }>,
  request: Request,
  token: string,
  path: string,
): Promise<Response> {
  try {
    // Find the event config to get the signing key
    const config = await findEventForPath(path, c.env.CONFIG_KV);
    if (!config) {
      // Path not protected, pass through even though token exists
      return fetch(request);
    }

    const signingKey = await c.env.CONFIG_KV.get(`${SIGNING_KEY_PREFIX}${config.eventId}`);
    if (!signingKey) {
      // Signing key missing — CRITICAL but fail-open
      console.error(`[Gateway] Signing key missing for event ${config.eventId}, failing open`);
      return proxyToOrigin(request, config.originUrl);
    }

    // Verify token with grace period
    const claims = await verifyToken(token, signingKey, TOKEN_GRACE_PERIOD_SECONDS);

    // Verify the token is for the right event
    if (claims.evt !== config.eventId) {
      // Token for different event — redirect to queue
      return redirectToQueue(c, config.eventId);
    }

    // Valid token — proxy to origin
    return proxyToOrigin(request, config.originUrl);
  } catch (e) {
    if (e instanceof TokenExpiredError) {
      // Past grace period — need to re-queue
      const config = await findEventForPath(path, c.env.CONFIG_KV);
      if (config) {
        return redirectToQueue(c, config.eventId);
      }
    }

    // Any other error (malformed, bad sig) — redirect to queue
    const config = await findEventForPath(path, c.env.CONFIG_KV);
    if (config) {
      return redirectToQueue(c, config.eventId);
    }

    // Can't find config — fail open
    return fetch(request);
  }
}

async function handleWithoutToken(
  c: Context<{ Bindings: GatewayEnv }>,
  request: Request,
  path: string,
): Promise<Response> {
  try {
    const config = await findEventForPath(path, c.env.CONFIG_KV);

    if (!config) {
      // Not a protected path — pass through
      return fetch(request);
    }

    // Protected path, no token — redirect to queue
    return redirectToQueue(c, config.eventId);
  } catch (e) {
    // KV or DO error — fail open
    console.error("[Gateway] Error checking event config, failing open:", e);
    return fetch(request);
  }
}

function redirectToQueue(c: Context, eventId: string): Response {
  const originalUrl = new URL(c.req.url);

  // Build a clean queue URL — don't carry over query params from the original request
  const queueUrl = new URL(c.req.url);
  queueUrl.pathname = "/queue";
  queueUrl.search = ""; // wipe all existing params
  queueUrl.searchParams.set("event", eventId);
  queueUrl.searchParams.set("return_url", originalUrl.toString());
  return c.redirect(queueUrl.toString(), 302);
}

async function proxyToOrigin(request: Request, originUrl: string): Promise<Response> {
  const url = new URL(request.url);
  const origin = new URL(originUrl);
  url.hostname = origin.hostname;
  url.protocol = origin.protocol;
  url.port = origin.port;

  const proxyRequest = new Request(url.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: "follow",
  });

  try {
    return await fetch(proxyRequest);
  } catch (e) {
    console.error("[Gateway] Origin proxy failed:", e);
    return new Response("Bad Gateway", { status: 502 });
  }
}
