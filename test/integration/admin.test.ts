// ============================================================
// Integration tests: Admin API
//
// Tests the admin Hono app with real KV and DO bindings.
// Since vitest is configured for the queue-worker, we import
// the admin app directly and call it with mock env bindings
// from the Miniflare environment.
// ============================================================

import { describe, test, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import adminApp from "../../src/admin/index.js";

// The env from cloudflare:test gives us the Miniflare bindings
// configured in vitest.config.ts (CONFIG_KV, QUEUE_DO).
// We add ADMIN_API_KEY for the auth middleware.
const API_KEY = "test-admin-key-1234";

function getEnv() {
  return {
    CONFIG_KV: env.CONFIG_KV,
    // Omit QUEUE_DO so DO notifications (create/update/rate) are skipped.
    // The notifyDO helper in handlers.ts safely catches the resulting error.
    ADMIN_API_KEY: API_KEY,
  };
}

const mockCtx = {
  waitUntil: (_p: Promise<unknown>) => { /* drop */ },
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`https://admin.test${path}`, init);
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
}

function makeEventInput(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "test-" + crypto.randomUUID().slice(0, 8),
    name: "Test Event",
    protectedPaths: ["/tickets/*"],
    originUrl: "https://origin.example.com",
    ...overrides,
  };
}

// Helper to call the admin app with a mock execution context
async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const req = makeRequest(path, init);
  return adminApp.fetch(req, getEnv(), mockCtx);
}

describe("Admin API Integration", () => {
  beforeEach(async () => {
    // Clean KV state between tests
    const list = await env.CONFIG_KV.list();
    for (const key of list.keys) {
      await env.CONFIG_KV.delete(key.name);
    }
  });

  // ── Health check ──

  describe("GET /health", () => {
    test("returns ok without auth", async () => {
      const res = await adminFetch("/health");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; worker: string };
      expect(body).toEqual({ status: "ok", worker: "queue-admin" });
    });
  });

  // ── Auth middleware ──

  describe("Authentication", () => {
    test("rejects requests without Authorization header", async () => {
      const res = await adminFetch("/api/events");
      expect(res.status).toBe(401);
    });

    test("rejects requests with wrong API key", async () => {
      const res = await adminFetch("/api/events", {
        headers: { Authorization: "Bearer wrong-key" },
      });
      expect(res.status).toBe(401);
    });

    test("rejects malformed Authorization header", async () => {
      const res = await adminFetch("/api/events", {
        headers: { Authorization: "Basic wrong-scheme" },
      });
      expect(res.status).toBe(401);
    });

    test("accepts valid API key", async () => {
      const res = await adminFetch("/api/events", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
    });
  });

  // ── Event CRUD ──

  describe("POST /api/events", () => {
    test("creates event with valid input", async () => {
      const input = makeEventInput();
      const res = await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(input),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.eventId).toBe(input.eventId);
      expect(body.name).toBe("Test Event");
      expect(body.enabled).toBe(true);
      expect(body.releaseRate).toBe(60);
      expect(body.createdAt).toBeDefined();
    });

    test("creates event with custom config", async () => {
      const input = makeEventInput({
        releaseRate: 120,
        tokenTtlSeconds: 600,
        failMode: "closed",
        mode: "threshold",
        activationThreshold: 100,
        maxQueueSize: 5000,
      });

      const res = await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(input),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.releaseRate).toBe(120);
      expect(body.tokenTtlSeconds).toBe(600);
      expect(body.failMode).toBe("closed");
      expect(body.mode).toBe("threshold");
    });

    test("rejects duplicate event ID", async () => {
      const input = makeEventInput();
      await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(input),
      });

      const res = await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(input),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { fields?: Record<string, string> };
      expect(body.fields?.eventId).toContain("already exists");
    });

    test("rejects missing required fields", async () => {
      const res = await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: "No Event ID" }),
      });
      expect(res.status).toBe(400);
    });

    test("rejects non-HTTPS origin URL", async () => {
      const res = await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(
          makeEventInput({ originUrl: "http://insecure.example.com" }),
        ),
      });
      expect(res.status).toBe(400);
    });

    test("rejects invalid JSON body", async () => {
      const res = await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: "not json",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/events", () => {
    test("returns empty list initially", async () => {
      const res = await adminFetch("/api/events", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { events: unknown[]; total: number };
      expect(body.events).toEqual([]);
      expect(body.total).toBe(0);
    });

    test("lists created events", async () => {
      const input1 = makeEventInput();
      const input2 = makeEventInput();
      await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(input1),
      });
      await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(input2),
      });

      const res = await adminFetch("/api/events", {
        headers: authHeaders(),
      });
      const body = (await res.json()) as { events: unknown[]; total: number };
      expect(body.total).toBe(2);
      expect(body.events).toHaveLength(2);
    });
  });

  describe("GET /api/events/:id", () => {
    test("returns event by ID", async () => {
      const input = makeEventInput();
      await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(input),
      });

      const res = await adminFetch(`/api/events/${input.eventId}`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { eventId: string };
      expect(body.eventId).toBe(input.eventId);
    });

    test("returns 404 for non-existent event", async () => {
      const res = await adminFetch("/api/events/does-not-exist", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/events/:id", () => {
    test("updates event fields", async () => {
      const input = makeEventInput();
      await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(input),
      });

      const res = await adminFetch(`/api/events/${input.eventId}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ name: "Updated Name", releaseRate: 120 }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        name: string;
        releaseRate: number;
        eventId: string;
      };
      expect(body.name).toBe("Updated Name");
      expect(body.releaseRate).toBe(120);
      expect(body.eventId).toBe(input.eventId);
    });

    test("preserves immutable fields (eventId, createdAt)", async () => {
      const input = makeEventInput();
      await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(input),
      });

      const res = await adminFetch(`/api/events/${input.eventId}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ eventId: "hijacked-id", name: "Updated" }),
      });
      const body = (await res.json()) as { eventId: string };
      expect(body.eventId).toBe(input.eventId); // not "hijacked-id"
    });

    test("returns 404 for non-existent event", async () => {
      const res = await adminFetch("/api/events/does-not-exist", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ name: "Nope" }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/events/:id", () => {
    test("deletes existing event and removes signing key", async () => {
      const input = makeEventInput();
      await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(input),
      });

      const res = await adminFetch(`/api/events/${input.eventId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { deleted: boolean };
      expect(body.deleted).toBe(true);

      // Verify event is gone
      const check = await adminFetch(`/api/events/${input.eventId}`, {
        headers: authHeaders(),
      });
      expect(check.status).toBe(404);

      // Verify signing key is also removed
      const sigKey = await env.CONFIG_KV.get(`signing_key:${input.eventId}`);
      expect(sigKey).toBeNull();
    });

    test("returns 404 for non-existent event", async () => {
      const res = await adminFetch("/api/events/does-not-exist", {
        method: "DELETE",
        headers: authHeaders(),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/events/:id/rate", () => {
    test("updates release rate", async () => {
      const input = makeEventInput();
      await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(input),
      });

      const res = await adminFetch(`/api/events/${input.eventId}/rate`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ releaseRate: 200 }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { releaseRate: number };
      expect(body.releaseRate).toBe(200);

      // Verify persisted
      const check = await adminFetch(`/api/events/${input.eventId}`, {
        headers: authHeaders(),
      });
      const config = (await check.json()) as { releaseRate: number };
      expect(config.releaseRate).toBe(200);
    });

    test("rejects negative release rate", async () => {
      const input = makeEventInput();
      await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(input),
      });

      const res = await adminFetch(`/api/events/${input.eventId}/rate`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ releaseRate: -5 }),
      });
      expect(res.status).toBe(400);
    });

    test("accepts zero release rate (pause queue)", async () => {
      const input = makeEventInput();
      await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(input),
      });

      const res = await adminFetch(`/api/events/${input.eventId}/rate`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ releaseRate: 0 }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/events/:id/stats", () => {
    // NOTE: Stats endpoint requires calling the Durable Object which can't
    // be tested via direct app.fetch() due to isolated storage constraints.
    // The stats endpoint is tested in worker.test.ts via SELF and in
    // e2e-flow.test.ts via the DO /stats endpoint directly.
    test("returns 500 when DO binding is unavailable", async () => {
      const input = makeEventInput();
      await adminFetch("/api/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(input),
      });

      // Without QUEUE_DO binding, stats should return 500
      const res = await adminFetch(`/api/events/${input.eventId}/stats`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(500);
    });
  });
});
