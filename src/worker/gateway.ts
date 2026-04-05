// ============================================================
// Gateway — token verification, proxy, and queue redirect
//
// Decision tree:
//   Request ──▶ has token cookie?
//     ├── YES ──▶ verify token
//     │   ├── valid + schedule OK ──▶ proxy to origin (edge cached)
//     │   ├── expired (within grace) ──▶ proxy to origin (edge cached)
//     │   ├── expired (past grace) ──▶ redirect to queue
//     │   └── malformed/bad sig ──▶ redirect to queue
//     └── NO ──▶ match protected path?
//         ├── YES ──▶ check schedule
//         │   ├── not started yet ──▶ 403 (event not started)
//         │   ├── ended ──▶ pass through (edge cached)
//         │   └── active ──▶ redirect to queue page
//         └── NO ──▶ pass through (not protected)
//
// Edge caching (origin protection):
//   Two caching strategies:
//   1. proxyToOrigin — Cache API for protected paths (token-verified visitors).
//   2. passthroughWithCache — Cache API for non-protected paths (homepage, etc).
//   Both use caches.default to store/retrieve at the edge.
//   Config: edgeCacheTtl (default 60s), browserCacheTtl (default 0s).
//
// Fail mode:
//   "open"   → if DO or KV is unreachable, proxy to origin
//   "closed" → if DO or KV is unreachable, return 503
// ============================================================

import type { Context } from "hono";
import { verifyToken } from "../shared/jwt.js";
import {
  TOKEN_COOKIE_NAME,
  TOKEN_GRACE_PERIOD_SECONDS,
  EVENT_CONFIG_PREFIX,
  SIGNING_KEY_PREFIX,
  PATH_INDEX_KEY,
  DEFAULT_EDGE_CACHE_TTL,
  DEFAULT_BROWSER_CACHE_TTL,
} from "../shared/constants.js";
import { TokenExpiredError, TokenSignatureError } from "../shared/errors.js";
import type { EventConfig, FailMode } from "../shared/config.js";

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

/**
 * Check if an event is within its active schedule window.
 * @returns "active" | "not_started" | "ended"
 */
function checkSchedule(config: EventConfig): "active" | "not_started" | "ended" {
  const now = Date.now();

  if (config.eventStartTime) {
    const start = new Date(config.eventStartTime).getTime();
    if (!isNaN(start) && now < start) {
      return "not_started";
    }
  }

  if (config.eventEndTime) {
    const end = new Date(config.eventEndTime).getTime();
    if (!isNaN(end) && now > end) {
      return "ended";
    }
  }

  return "active";
}

/**
 * Handle a system failure according to the event's failMode.
 * "open" → proxy to origin (default). "closed" → return 503.
 */
function handleFailure(
  request: Request,
  failMode: FailMode | undefined,
  originUrl: string | undefined,
  reason: string,
): Promise<Response> | Response {
  const mode = failMode ?? "open";
  if (mode === "closed") {
    console.error(`[Gateway] fail-closed: ${reason}`);
    return new Response("Service Temporarily Unavailable", {
      status: 503,
      headers: { "Retry-After": "30" },
    });
  }
  // fail-open — proxy with edge cache
  if (originUrl) {
    return proxyToOrigin(request, originUrl);
  }
  return passthroughWithCache(request);
}

/**
 * Load all signing keys from KV. Supports both legacy (plain string)
 * and new (JSON array) formats for backward compatibility.
 */
function parseSigningKeysFromRaw(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return (parsed as { key: string }[]).map((k) => k.key);
    }
  } catch {
    // Not JSON — legacy plain string
  }
  return [raw];
}

/**
 * Verify a token against all available signing keys.
 * Returns claims on first successful verification.
 * Throws the error from the last key attempt on total failure.
 */
async function verifyTokenWithKeys(
  token: string,
  keys: string[],
  gracePeriodSeconds: number,
): ReturnType<typeof verifyToken> {
  let lastError: unknown;
  for (const key of keys) {
    try {
      return await verifyToken(token, key, gracePeriodSeconds);
    } catch (e) {
      lastError = e;
      // If the token is expired, it's expired regardless of which key we use
      if (e instanceof TokenExpiredError) {
        throw e;
      }
      // TokenSignatureError → try next key
      if (e instanceof TokenSignatureError) {
        continue;
      }
      // Any other error (parse error) → no point trying other keys
      throw e;
    }
  }
  throw lastError;
}

/**
 * Passthrough a request with Cache API edge caching.
 * For GET/HEAD requests, checks the cache first and stores the response.
 * For mutations (POST/PUT/DELETE), passes through without caching.
 *
 * This protects the origin even for non-protected paths (homepage, event pages,
 * static assets, images, etc.) that don't go through the queue flow.
 */
async function passthroughWithCache(
  request: Request,
  edgeCacheTtl?: number,
): Promise<Response> {
  const isGetOrHead = request.method === "GET" || request.method === "HEAD";
  const effectiveEdgeTtl = edgeCacheTtl ?? DEFAULT_EDGE_CACHE_TTL;

  if (!isGetOrHead || effectiveEdgeTtl <= 0) {
    return fetch(request);
  }

  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: request.method });

  const cached = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("X-Cache-Status", "HIT");
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }

  const response = await fetch(request);
  if (!response.ok) {
    return response;
  }

  const cacheHeaders = new Headers(response.headers);
  cacheHeaders.set("X-Cache-Status", "MISS");
  // Cache API uses Cache-Control max-age to determine storage TTL
  cacheHeaders.set("Cache-Control", `public, max-age=${effectiveEdgeTtl}`);

  const responseToCache = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: cacheHeaders,
  });

  const responseForClient = responseToCache.clone();
  // Await cache.put to ensure it completes before the Worker exits.
  // Without await (or waitUntil), Cloudflare may cancel the background write.
  try {
    await cache.put(cacheKey, responseToCache);
  } catch (e) {
    console.error("[Gateway] cache.put failed (passthrough):", e);
  }
  return responseForClient;
}

/** Main gateway handler */
export async function handleGateway(
  c: Context<{ Bindings: GatewayEnv }>,
): Promise<Response> {
  const request = c.req.raw;
  const url = new URL(request.url);
  const path = url.pathname;

  // Guard: never redirect queue paths back to the queue (prevent redirect loop)
  // Queue paths are dynamic (HTML injection, WS upgrade, polling) — no caching.
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
  // Hoist config lookup so it's available in the catch block
  let config: EventConfig | null = null;
  try {
    config = await findEventForPath(path, c.env.CONFIG_KV);
  } catch (e) {
    // KV error — handle based on failMode (unknown here, default open)
    console.error("[Gateway] KV error looking up config, failing open:", e);
    return passthroughWithCache(request);
  }

  if (!config) {
    // Path not protected, pass through even though token exists
    return passthroughWithCache(request);
  }

  // Check schedule — event may have ended
  const schedule = checkSchedule(config);
  if (schedule === "ended") {
    // Event is over — pass through, no queue needed
    return proxyToOrigin(request, config.originUrl, config.edgeCacheTtl, config.browserCacheTtl);
  }

  try {
    const signingKeyRaw = await c.env.CONFIG_KV.get(`${SIGNING_KEY_PREFIX}${config.eventId}`);
    if (!signingKeyRaw) {
      // Signing key missing — CRITICAL, handle per failMode
      return handleFailure(request, config.failMode, config.originUrl, `Signing key missing for event ${config.eventId}`);
    }

    // Parse all signing keys (supports legacy string + new JSON array format)
    const keys = parseSigningKeysFromRaw(signingKeyRaw);

    // Verify token against all available keys (key rotation support)
    const claims = await verifyTokenWithKeys(token, keys, TOKEN_GRACE_PERIOD_SECONDS);

    // Verify the token is for the right event
    if (claims.evt !== config.eventId) {
      // Token for different event — redirect to queue
      return redirectToQueue(c, config.eventId);
    }

    // Valid token — proxy to origin
    return proxyToOrigin(request, config.originUrl, config.edgeCacheTtl, config.browserCacheTtl);
  } catch (e) {
    if (e instanceof TokenExpiredError) {
      // Past grace period — need to re-queue
      return redirectToQueue(c, config.eventId);
    }

    // Any other error (malformed, bad sig) — redirect to queue
    return redirectToQueue(c, config.eventId);
  }
}

async function handleWithoutToken(
  c: Context<{ Bindings: GatewayEnv }>,
  request: Request,
  path: string,
): Promise<Response> {
  let config: EventConfig | null = null;
  try {
    config = await findEventForPath(path, c.env.CONFIG_KV);
  } catch (e) {
    // KV or DO error — handle per failMode (unknown, default open)
    console.error("[Gateway] Error checking event config:", e);
    return passthroughWithCache(request);
  }

  if (!config) {
    // Not a protected path — pass through with edge cache
    return passthroughWithCache(request);
  }

  // Check schedule
  const schedule = checkSchedule(config);
  if (schedule === "not_started") {
    console.log(`[Gateway] Event ${config.eventId} not started yet (starts ${config.eventStartTime})`);
    return new Response("Event has not started yet. Please come back later.", {
      status: 403,
      headers: { "Content-Type": "text/plain" },
    });
  }
  if (schedule === "ended") {
    // Event is over — pass through, no queue needed
    return proxyToOrigin(request, config.originUrl, config.edgeCacheTtl, config.browserCacheTtl);
  }

  // Protected path, active event, no token — redirect to queue
  return redirectToQueue(c, config.eventId);
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

/**
 * Proxy a request to the origin server with Cloudflare edge caching.
 *
 * Cache strategy (two layers):
 *
 *   Layer 1 — Cache API (caches.default):
 *     Workers running on the same zone as the origin can't rely on cf.cacheTtl
 *     (the fetch stays internal and never traverses the CDN cache layer).
 *     We explicitly use the Cache API to store/retrieve responses at the edge.
 *     This works regardless of whether the origin is same-zone or external.
 *
 *   Layer 2 — cf.cacheTtl (fallback for external origins):
 *     When the origin is on a different domain, cf.cacheTtl + cf.cacheEverything
 *     provides a second layer of caching via the standard CDN pipeline.
 *     Both layers can coexist; Cache API is checked first.
 *
 * Browser caching:
 *   Cache-Control header controls browser max-age. Default 0 (no browser cache)
 *   so browsers always revalidate with the edge — the edge serves from Cache API.
 *
 * @param request - The original visitor request
 * @param originUrl - The origin server base URL
 * @param edgeCacheTtl - Seconds to cache at Cloudflare edge (0 = no edge cache)
 * @param browserCacheTtl - Seconds for browser Cache-Control max-age (0 = no-store)
 */
async function proxyToOrigin(
  request: Request,
  originUrl: string,
  edgeCacheTtl?: number,
  browserCacheTtl?: number,
): Promise<Response> {
  const url = new URL(request.url);
  const origin = new URL(originUrl);
  url.hostname = origin.hostname;
  url.protocol = origin.protocol;
  url.port = origin.port;

  const effectiveEdgeTtl = edgeCacheTtl ?? DEFAULT_EDGE_CACHE_TTL;
  const effectiveBrowserTtl = browserCacheTtl ?? DEFAULT_BROWSER_CACHE_TTL;
  const isGetOrHead = request.method === "GET" || request.method === "HEAD";

  // ── Layer 1: Cache API (works for same-zone AND external origins) ──
  if (isGetOrHead && effectiveEdgeTtl > 0) {
    // Use the original request URL as cache key (not the rewritten origin URL)
    // so all visitors for the same page URL share one cache entry.
    const cacheKey = new Request(request.url, { method: request.method });
    const cache = caches.default;

    const cached = await cache.match(cacheKey);
    if (cached) {
      // Edge cache HIT — return immediately without hitting origin
      const headers = new Headers(cached.headers);
      headers.set("X-Cache-Status", "HIT");
      // Override Cache-Control for the browser (edge TTL was used for storage only)
      setBrowserCacheHeaders(headers, effectiveBrowserTtl);
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }

    // Edge cache MISS — fetch from origin, then cache the response
    const originResponse = await fetchOrigin(request, url, effectiveEdgeTtl);
    if (!originResponse.ok) {
      // Don't cache error responses
      return originResponse;
    }

    // Build the cacheable response with proper headers
    const cacheHeaders = new Headers(originResponse.headers);
    cacheHeaders.set("X-Cache-Status", "MISS");
    // Cache API uses Cache-Control max-age to determine how long to store.
    // We set edgeTtl here so the entry expires correctly in the cache.
    cacheHeaders.set("Cache-Control", `public, max-age=${effectiveEdgeTtl}`);

    const responseToCache = new Response(originResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: cacheHeaders,
    });

    // Clone for the client BEFORE cache.put consumes the body
    const responseForClient = responseToCache.clone();
    // Await cache.put to ensure it completes before the Worker exits.
    try {
      await cache.put(cacheKey, responseToCache);
    } catch (e) {
      console.error("[Gateway] cache.put failed (proxy):", e);
    }

    // Override Cache-Control for the browser on the client response
    const clientHeaders = new Headers(responseForClient.headers);
    setBrowserCacheHeaders(clientHeaders, effectiveBrowserTtl);
    return new Response(responseForClient.body, {
      status: responseForClient.status,
      statusText: responseForClient.statusText,
      headers: clientHeaders,
    });
  }

  // ── Non-cacheable request (POST/PUT/DELETE or edgeTtl=0) ──
  return fetchOrigin(request, url, 0);
}

/**
 * Fetch from the origin server. Uses cf.cacheTtl as a fallback
 * for external origins where the CDN pipeline is active.
 */
async function fetchOrigin(
  request: Request,
  originUrl: URL,
  edgeCacheTtl: number,
): Promise<Response> {
  const isGetOrHead = request.method === "GET" || request.method === "HEAD";

  // cf.cacheTtl works for external origins (different zone).
  // For same-zone origins it's a no-op but harmless.
  const cfOptions: Record<string, unknown> = {};
  if (isGetOrHead && edgeCacheTtl > 0) {
    cfOptions.cacheTtl = edgeCacheTtl;
    cfOptions.cacheEverything = true;
  }

  const proxyRequest = new Request(originUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: "follow",
    cf: Object.keys(cfOptions).length > 0 ? cfOptions : undefined,
  });

  try {
    return await fetch(proxyRequest);
  } catch (e) {
    console.error("[Gateway] Origin fetch failed:", e);
    return new Response("Bad Gateway", { status: 502 });
  }
}

/** Set browser-facing Cache-Control headers */
function setBrowserCacheHeaders(headers: Headers, browserCacheTtl: number): void {
  if (browserCacheTtl > 0) {
    headers.set("Cache-Control", `public, max-age=${browserCacheTtl}`);
  } else {
    // No browser cache — force revalidation with edge on every request
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  }
}
