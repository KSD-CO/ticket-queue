// ============================================================
// Integration tests: Queue Worker (gateway + queue page routes)
//
// Tests the visitor-facing Hono app with real KV and DO
// bindings via Miniflare. Covers gateway routing, queue page
// serving, WebSocket upgrade, and HTTP polling.
// ============================================================

import { describe, test, expect, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { signToken, type QueueTokenClaims } from "../../src/shared/jwt.js";

const TEST_EVENT_ID = "integration-test-event";
const TEST_ORIGIN = "https://origin.example.com";
const TEST_SIGNING_KEY = "integration-test-signing-key-super-secret";

async function seedEvent(
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const config = {
    eventId: TEST_EVENT_ID,
    name: "Integration Test Event",
    enabled: true,
    protectedPaths: ["/tickets/*", "/checkout"],
    originUrl: TEST_ORIGIN,
    releaseRate: 60,
    mode: "always",
    tokenTtlSeconds: 1800,
    failMode: "open",
    turnstileEnabled: false,
    maxQueueSize: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };

  await env.CONFIG_KV.put(`event:${config.eventId}`, JSON.stringify(config));
  await env.CONFIG_KV.put(`signing_key:${config.eventId}`, TEST_SIGNING_KEY);

  // Build path index and event IDs index for the gateway
  const pathMap: Record<string, string> = {};
  for (const p of config.protectedPaths as string[]) {
    pathMap[p] = config.eventId as string;
  }
  await env.CONFIG_KV.put("_index:path_map", JSON.stringify(pathMap));
  await env.CONFIG_KV.put("_index:event_ids", JSON.stringify([config.eventId]));
}

async function makeValidToken(
  overrides: Partial<QueueTokenClaims> = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: QueueTokenClaims = {
    sub: "visitor-" + crypto.randomUUID().slice(0, 8),
    evt: TEST_EVENT_ID,
    iat: now,
    exp: now + 1800,
    pos: 1,
    ...overrides,
  };
  return signToken(claims, TEST_SIGNING_KEY);
}

describe("Queue Worker Integration", () => {
  beforeEach(async () => {
    const list = await env.CONFIG_KV.list();
    for (const key of list.keys) {
      await env.CONFIG_KV.delete(key.name);
    }
  });

  // ── Health check ──

  describe("GET /health", () => {
    test("returns ok", async () => {
      const res = await SELF.fetch("https://worker.test/health");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; worker: string };
      expect(body).toEqual({ status: "ok", worker: "queue-worker" });
    });
  });

  // ── Queue page ──

  describe("GET /queue", () => {
    test("returns 400 without event parameter", async () => {
      const res = await SELF.fetch("https://worker.test/queue");
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain("Missing event parameter");
    });

    test("returns HTML with event parameter", async () => {
      await seedEvent();
      const res = await SELF.fetch(
        `https://worker.test/queue?event=${TEST_EVENT_ID}&return_url=/tickets`,
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(TEST_EVENT_ID);
      expect(html).toContain("queue");
    });
  });

  // ── WebSocket endpoint ──

  describe("GET /queue/ws", () => {
    test("returns 400 without event parameter", async () => {
      const res = await SELF.fetch("https://worker.test/queue/ws");
      expect(res.status).toBe(400);
    });
  });

  // ── HTTP polling ──

  describe("GET /queue/poll", () => {
    test("returns 400 without event parameter", async () => {
      const res = await SELF.fetch("https://worker.test/queue/poll");
      expect(res.status).toBe(400);
    });

    test("returns stats with event parameter", async () => {
      await seedEvent();
      const res = await SELF.fetch(
        `https://worker.test/queue/poll?event=${TEST_EVENT_ID}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { activeVisitors: number };
      expect(body.activeVisitors).toBeDefined();
    });
  });

  // ── Gateway ──

  describe("Gateway catch-all", () => {
    test("non-protected path passes through (no event config)", async () => {
      // No events configured — all paths pass through
      const res = await SELF.fetch("https://worker.test/public/page");
      // fetch() in Miniflare goes to the internet; we just verify it doesn't
      // redirect to /queue (status would be 302 if it did)
      expect(res.status).not.toBe(302);
    });

    test("protected path without token redirects to queue", async () => {
      await seedEvent();
      const res = await SELF.fetch("https://worker.test/tickets/123", {
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      const location = res.headers.get("Location") ?? "";
      expect(location).toContain("/queue");
      expect(location).toContain(`event=${TEST_EVENT_ID}`);
      expect(location).toContain("return_url=");
    });

    test("protected path with valid token proxies through", async () => {
      await seedEvent();
      const token = await makeValidToken();
      const res = await SELF.fetch("https://worker.test/tickets/123", {
        headers: { Cookie: `__queue_token=${token}` },
        redirect: "manual",
      });
      // Should NOT redirect to queue — it either proxies (which may fail
      // since origin doesn't exist) or passes through
      expect(res.status).not.toBe(302);
    });

    test("protected path with expired token redirects to queue", async () => {
      await seedEvent();
      const now = Math.floor(Date.now() / 1000);
      const token = await makeValidToken({
        iat: now - 7200,
        exp: now - 3600, // expired 1 hour ago
      });
      const res = await SELF.fetch("https://worker.test/tickets/123", {
        headers: { Cookie: `__queue_token=${token}` },
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      const location = res.headers.get("Location") ?? "";
      expect(location).toContain("/queue");
    });

    test("protected path with tampered token redirects to queue", async () => {
      await seedEvent();
      const token = (await makeValidToken()) + "tampered";
      const res = await SELF.fetch("https://worker.test/tickets/123", {
        headers: { Cookie: `__queue_token=${token}` },
        redirect: "manual",
      });
      expect(res.status).toBe(302);
    });

    test("token for wrong event redirects to queue", async () => {
      await seedEvent();
      const token = await makeValidToken({ evt: "different-event" });
      const res = await SELF.fetch("https://worker.test/tickets/123", {
        headers: { Cookie: `__queue_token=${token}` },
        redirect: "manual",
      });
      expect(res.status).toBe(302);
    });

    test("wildcard path matching works", async () => {
      await seedEvent({ protectedPaths: ["/tickets/*"] });

      // /tickets/abc should be protected
      const res1 = await SELF.fetch("https://worker.test/tickets/abc", {
        redirect: "manual",
      });
      expect(res1.status).toBe(302);

      // /tickets/abc/def should be protected (wildcard)
      const res2 = await SELF.fetch("https://worker.test/tickets/abc/def", {
        redirect: "manual",
      });
      expect(res2.status).toBe(302);
    });

    test("exact path matching works", async () => {
      await seedEvent({ protectedPaths: ["/checkout"] });

      // /checkout should be protected
      const res = await SELF.fetch("https://worker.test/checkout", {
        redirect: "manual",
      });
      expect(res.status).toBe(302);
    });

    test("disabled event does not protect paths", async () => {
      await seedEvent({ enabled: false });
      const res = await SELF.fetch("https://worker.test/tickets/123", {
        redirect: "manual",
      });
      // Disabled event = path not protected = pass through
      expect(res.status).not.toBe(302);
    });
  });
});
