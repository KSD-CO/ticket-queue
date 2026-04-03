// ============================================================
// Worker 1 entry point: visitor-facing (Gateway + Queue Page)
//
// Route map:
//   /queue       → queue page (waiting room HTML)
//   /queue/ws    → WebSocket upgrade → Durable Object
//   /queue/poll  → HTTP polling fallback
//   /*           → gateway (token check → proxy or redirect)
// ============================================================

import { Hono } from "hono";
import { handleGateway } from "./gateway.js";
import { handleQueuePage, handleQueueWebSocket, handleQueuePoll } from "./queue-page.js";

// Re-export the Durable Object class so wrangler can find it
export { QueueDurableObject } from "./durable-object.js";

interface Env {
  CONFIG_KV: KVNamespace;
  QUEUE_DO: DurableObjectNamespace;
  ASSETS: Fetcher;
}

const app = new Hono<{ Bindings: Env }>();

// ── Queue routes (must be before the catch-all gateway) ──

app.get("/queue", handleQueuePage);
app.get("/queue/ws", handleQueueWebSocket);
app.get("/queue/poll", handleQueuePoll);

// ── Health check ──

app.get("/health", (c) => c.json({ status: "ok", worker: "queue-worker" }));

// ── Gateway catch-all (all other routes) ──

app.all("/*", handleGateway);

export default app;
