// ============================================================
// Queue page handler — serves the waiting room
//
// Flow:
//   1. Visitor redirected here by gateway (no valid token)
//   2. Serve queue.html from static assets (ASSETS binding)
//   3. queue.js opens WebSocket to DO via /queue/ws
//   4. DO assigns position, pushes updates
//   5. When released, client receives token and redirects
//
// Cache strategy:
//   - Queue HTML: no-store (dynamic — contains injected event ID)
//   - Static assets (queue.js, queue.css): served by Cloudflare's
//     asset platform with automatic CDN edge caching
// ============================================================

import type { Context } from "hono";

interface QueuePageEnv {
  QUEUE_DO: DurableObjectNamespace;
  CONFIG_KV: KVNamespace;
  ASSETS: Fetcher;
}

/** Serve the queue page HTML */
export async function handleQueuePage(
  c: Context<{ Bindings: QueuePageEnv }>,
): Promise<Response> {
  const eventId = c.req.query("event");
  const returnUrl = c.req.query("return_url") ?? "/";

  if (!eventId) {
    return c.text("Missing event parameter", 400);
  }

  // Serve from static assets (ASSETS binding is always available in production)
  const assetResponse = await c.env.ASSETS.fetch(
    new Request(new URL("/queue.html", c.req.url)),
  );
  if (!assetResponse.ok) {
    console.error(`[QueuePage] Failed to load queue.html from assets: ${assetResponse.status}`);
    return c.text("Queue page unavailable", 500);
  }

  // Inject event ID and return URL into the HTML template
  let html = await assetResponse.text();
  html = html.replaceAll("{{EVENT_ID}}", eventId);
  html = html.replaceAll("{{RETURN_URL}}", encodeURIComponent(returnUrl));

  // No browser cache — HTML is dynamic (contains injected event/return data)
  return c.html(html, 200, {
    "Cache-Control": "no-store",
  });
}

/** Handle WebSocket upgrade to Durable Object */
export async function handleQueueWebSocket(
  c: Context<{ Bindings: QueuePageEnv }>,
): Promise<Response> {
  const eventId = c.req.query("event");
  if (!eventId) {
    return c.text("Missing event parameter", 400);
  }

  // Route to the correct Durable Object instance (one per event)
  const doId = c.env.QUEUE_DO.idFromName(eventId);
  const doStub = c.env.QUEUE_DO.get(doId);

  // Forward the WebSocket upgrade request to the DO
  const url = new URL(c.req.url);
  url.pathname = "/ws";
  url.searchParams.set("event", eventId);

  return doStub.fetch(
    new Request(url.toString(), {
      headers: c.req.raw.headers,
    }),
  );
}

/** Handle HTTP polling fallback for clients that can't use WebSocket */
export async function handleQueuePoll(
  c: Context<{ Bindings: QueuePageEnv }>,
): Promise<Response> {
  const eventId = c.req.query("event");
  const visitorId = c.req.query("visitor_id");
  const pollToken = c.req.query("poll_token");

  if (!eventId) {
    return c.json({ error: "Missing event parameter" }, 400);
  }

  // Route to DO
  const doId = c.env.QUEUE_DO.idFromName(eventId);
  const doStub = c.env.QUEUE_DO.get(doId);

  // If visitor_id and poll_token are provided, request individual visitor status
  if (visitorId && pollToken) {
    const pollUrl = new URL(c.req.url);
    pollUrl.pathname = "/visitor-status";
    pollUrl.search = "";
    pollUrl.searchParams.set("visitor_id", visitorId);
    pollUrl.searchParams.set("poll_token", pollToken);

    const response = await doStub.fetch(new Request(pollUrl.toString()));
    return response;
  }

  // Otherwise return aggregate stats
  const statsUrl = new URL(c.req.url);
  statsUrl.pathname = "/stats";

  const response = await doStub.fetch(new Request(statsUrl.toString()));
  return response;
}

