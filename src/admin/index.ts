// ============================================================
// Worker 2 entry point: Admin API
//
// Route map:
//   POST   /api/events          → create event
//   GET    /api/events          → list events
//   GET    /api/events/:id      → get event
//   PUT    /api/events/:id      → update event
//   DELETE /api/events/:id      → delete event
//   PUT    /api/events/:id/rate → adjust release rate
//   GET    /api/events/:id/stats → queue stats
//
// All routes require Bearer token authentication.
// ============================================================

import { Hono } from "hono";
import { cors } from "hono/cors";
import { adminAuth } from "./auth.js";
import { QueueError } from "../shared/errors.js";
import {
  createEvent,
  listEvents,
  getEvent,
  updateEvent,
  deleteEvent,
  updateRate,
  getStats,
} from "./handlers.js";

interface AdminEnv {
  CONFIG_KV: KVNamespace;
  QUEUE_DO: DurableObjectNamespace;
  ADMIN_API_KEY: string;
}

const app = new Hono<{ Bindings: AdminEnv }>();

// ── CORS (allow admin dashboard from any origin) ──

app.use("/*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
}));

// ── Global error handler ──

app.onError((err, c) => {
  if (err instanceof QueueError) {
    return c.json(err.toJSON(), err.statusCode as any);
  }
  console.error("[Admin] Unhandled error:", err);
  return c.json({ error: "INTERNAL_ERROR", message: "Internal server error" }, 500);
});

// ── Health check (no auth) ──

app.get("/health", (c) => c.json({ status: "ok", worker: "queue-admin" }));

// ── All API routes require auth ──

app.use("/api/*", adminAuth);

// ── Event CRUD ──

app.post("/api/events", createEvent);
app.get("/api/events", listEvents);
app.get("/api/events/:id", getEvent);
app.put("/api/events/:id", updateEvent);
app.delete("/api/events/:id", deleteEvent);

// ── Rate adjustment ──

app.put("/api/events/:id/rate", updateRate);

// ── Stats ──

app.get("/api/events/:id/stats", getStats);

export default app;
