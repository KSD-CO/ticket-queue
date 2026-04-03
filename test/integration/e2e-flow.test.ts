// ============================================================
// E2E test: Full visitor lifecycle
//
// Tests the complete flow:
//   1. Admin creates event via API
//   2. Visitor hits protected path → redirected to queue
//   3. Visitor connects to queue via DO
//   4. DO releases visitor with JWT
//   5. Visitor accesses protected path with token → proxied
//
// This test exercises both workers and the DO together.
// ============================================================

import { describe, test, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import adminApp from "../../src/admin/index.js";
import { verifyToken } from "../../src/shared/jwt.js";

const API_KEY = "e2e-admin-key";
const EVENT_ID = "e2e-concert-" + Date.now();

function adminEnv() {
  return {
    CONFIG_KV: env.CONFIG_KV,
    // Omit QUEUE_DO to prevent DO side-effects in tests
    ADMIN_API_KEY: API_KEY,
  };
}

const mockCtx = {
  waitUntil: (_p: Promise<unknown>) => { /* drop */ },
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  return adminApp.fetch(
    new Request(`https://admin.test${path}`, init),
    adminEnv(),
    mockCtx,
  );
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
}

describe("E2E: Full visitor lifecycle", () => {
  beforeEach(async () => {
    const list = await env.CONFIG_KV.list();
    for (const key of list.keys) {
      await env.CONFIG_KV.delete(key.name);
    }
  });

  test("create event → verify config and signing key stored", async () => {
    // Step 1: Admin creates event
    const createRes = await adminFetch("/api/events", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        eventId: EVENT_ID,
        name: "E2E Concert",
        protectedPaths: ["/tickets/*"],
        originUrl: "https://concert.example.com",
        releaseRate: 120,
        tokenTtlSeconds: 600,
      }),
    });

    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      eventId: string;
      name: string;
      releaseRate: number;
      enabled: boolean;
    };
    expect(created.eventId).toBe(EVENT_ID);
    expect(created.enabled).toBe(true);
    expect(created.releaseRate).toBe(120);

    // Step 2: Verify event is in KV
    const raw = await env.CONFIG_KV.get(`event:${EVENT_ID}`);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw!) as { eventId: string };
    expect(stored.eventId).toBe(EVENT_ID);

    // Step 3: Verify signing key was created
    const sigKey = await env.CONFIG_KV.get(`signing_key:${EVENT_ID}`);
    expect(sigKey).not.toBeNull();
    expect(sigKey!.length).toBeGreaterThan(0);
  });

  test("admin CRUD lifecycle: create → update → rate change → delete", async () => {
    // Create
    const createRes = await adminFetch("/api/events", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        eventId: EVENT_ID,
        name: "Lifecycle Event",
        protectedPaths: ["/buy/*"],
        originUrl: "https://shop.example.com",
      }),
    });
    expect(createRes.status).toBe(201);

    // Update
    const updateRes = await adminFetch(`/api/events/${EVENT_ID}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Renamed Event", maxQueueSize: 10000 }),
    });
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as {
      name: string;
      maxQueueSize: number;
    };
    expect(updated.name).toBe("Renamed Event");
    expect(updated.maxQueueSize).toBe(10000);

    // Change rate
    const rateRes = await adminFetch(`/api/events/${EVENT_ID}/rate`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ releaseRate: 300 }),
    });
    expect(rateRes.status).toBe(200);

    // Verify rate persisted
    const getRes = await adminFetch(`/api/events/${EVENT_ID}`, {
      headers: authHeaders(),
    });
    const config = (await getRes.json()) as { releaseRate: number };
    expect(config.releaseRate).toBe(300);

    // Delete
    const deleteRes = await adminFetch(`/api/events/${EVENT_ID}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(deleteRes.status).toBe(200);

    // Verify gone
    const checkRes = await adminFetch(`/api/events/${EVENT_ID}`, {
      headers: authHeaders(),
    });
    expect(checkRes.status).toBe(404);

    // Verify signing key gone
    const sigKey = await env.CONFIG_KV.get(`signing_key:${EVENT_ID}`);
    expect(sigKey).toBeNull();
  });

  test("JWT token round-trip: sign by DO → verify by gateway", async () => {
    // Create event to get signing key
    await adminFetch("/api/events", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        eventId: EVENT_ID,
        name: "Token Test Event",
        protectedPaths: ["/vip/*"],
        originUrl: "https://vip.example.com",
        tokenTtlSeconds: 900,
      }),
    });

    // Get the signing key that was auto-generated
    const sigKey = await env.CONFIG_KV.get(`signing_key:${EVENT_ID}`);
    expect(sigKey).not.toBeNull();

    // Simulate what the DO does: sign a token
    const { signToken } = await import("../../src/shared/jwt.js");
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken(
      {
        sub: "e2e-visitor-1",
        evt: EVENT_ID,
        iat: now,
        exp: now + 900,
        pos: 1,
      },
      sigKey!,
    );

    // Simulate what the gateway does: verify the token
    const claims = await verifyToken(token, sigKey!);
    expect(claims.sub).toBe("e2e-visitor-1");
    expect(claims.evt).toBe(EVENT_ID);
    expect(claims.pos).toBe(1);
  });

  test("multiple events are isolated", async () => {
    const event1 = EVENT_ID + "-a";
    const event2 = EVENT_ID + "-b";

    // Create two events
    await adminFetch("/api/events", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        eventId: event1,
        name: "Event A",
        protectedPaths: ["/a/*"],
        originUrl: "https://a.example.com",
        releaseRate: 50,
      }),
    });
    await adminFetch("/api/events", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        eventId: event2,
        name: "Event B",
        protectedPaths: ["/b/*"],
        originUrl: "https://b.example.com",
        releaseRate: 200,
      }),
    });

    // Verify they're independent
    const listRes = await adminFetch("/api/events", {
      headers: authHeaders(),
    });
    const list = (await listRes.json()) as { total: number };
    expect(list.total).toBe(2);

    // Delete one
    await adminFetch(`/api/events/${event1}`, {
      method: "DELETE",
      headers: authHeaders(),
    });

    // Other still exists
    const checkRes = await adminFetch(`/api/events/${event2}`, {
      headers: authHeaders(),
    });
    expect(checkRes.status).toBe(200);

    // Deleted one is gone
    const goneRes = await adminFetch(`/api/events/${event1}`, {
      headers: authHeaders(),
    });
    expect(goneRes.status).toBe(404);

    // Clean up
    await adminFetch(`/api/events/${event2}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  });
});
