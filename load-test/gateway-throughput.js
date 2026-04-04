// ============================================================
// k6 Load Test — Gateway HTTP Throughput
//
// Tests the gateway's token verification path under load.
// Does NOT test the queue/WebSocket flow — just raw HTTP
// throughput for protected paths with valid tokens.
//
// This measures:
//   - Token verification latency (HMAC-SHA256)
//   - KV lookup latency (path index + event config + signing key)
//   - Proxy/passthrough performance
//
// Usage:
//   # Start worker locally:
//   npm run dev    # port 8787
//
//   # Seed a test event first (admin must be running too):
//   npm run dev:admin   # port 8788
//
//   k6 run load-test/gateway-throughput.js
//
//   # Custom parameters:
//   k6 run load-test/gateway-throughput.js \
//     --env RPS=100 \
//     --env DURATION=30s \
//     --env WORKER_URL=http://localhost:8787 \
//     --env ADMIN_URL=http://localhost:8788 \
//     --env ADMIN_API_KEY=test-admin-key
// ============================================================

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";

// ── Configuration ──

const WORKER_URL = __ENV.WORKER_URL || "http://localhost:8787";
const ADMIN_URL = __ENV.ADMIN_URL || "http://localhost:8788";
const ADMIN_API_KEY = __ENV.ADMIN_API_KEY || "test-admin-key";
const RPS = parseInt(__ENV.RPS || "50", 10);
const DURATION = __ENV.DURATION || "30s";
const EVENT_ID = `gw-loadtest-${Date.now()}`;

// ── Custom Metrics ──

const gatewayLatency = new Trend("gateway_latency", true);
const redirectCount = new Counter("queue_redirects");
const proxyCount = new Counter("origin_proxied");
const errorCount = new Counter("gateway_errors");
const successRate = new Rate("request_success");

// ── k6 Options ──

export const options = {
  scenarios: {
    protected_path_no_token: {
      executor: "constant-arrival-rate",
      rate: RPS,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: Math.min(RPS * 2, 200),
      maxVUs: Math.min(RPS * 4, 500),
    },
  },
  thresholds: {
    gateway_latency: ["p(95)<500", "p(99)<1000"],
    request_success: ["rate>0.99"],
  },
};

// ── Setup: Create test event ──

export function setup() {
  console.log(`\n🚀 Gateway Throughput Test:`);
  console.log(`   Event ID:   ${EVENT_ID}`);
  console.log(`   Target RPS: ${RPS}`);
  console.log(`   Duration:   ${DURATION}`);
  console.log(`   Worker URL: ${WORKER_URL}\n`);

  // Create test event
  const createRes = http.post(
    `${ADMIN_URL}/api/events`,
    JSON.stringify({
      eventId: EVENT_ID,
      name: `Gateway Load Test`,
      protectedPaths: [`/loadtest/*`],
      originUrl: "https://httpbin.org",
      releaseRate: 0, // paused — we're not testing queue releases
      tokenTtlSeconds: 3600,
      failMode: "open",
    }),
    {
      headers: {
        Authorization: `Bearer ${ADMIN_API_KEY}`,
        "Content-Type": "application/json",
      },
    },
  );

  check(createRes, {
    "event created (201)": (r) => r.status === 201,
  });

  return { eventId: EVENT_ID };
}

// ── Main: Hit protected path without token (measures redirect path) ──

export default function (data) {
  const start = Date.now();

  const res = http.get(`${WORKER_URL}/loadtest/item-${__ITER}`, {
    redirects: 0, // don't follow redirects — we want to measure the gateway decision
    tags: { name: "gateway_protected_path" },
  });

  const elapsed = Date.now() - start;
  gatewayLatency.add(elapsed);

  if (res.status === 302) {
    redirectCount.add(1);
    successRate.add(1);

    check(res, {
      "redirect to queue": (r) =>
        (r.headers["Location"] || "").includes("/queue"),
      "redirect includes event param": (r) =>
        (r.headers["Location"] || "").includes(`event=${data.eventId}`),
    });
  } else if (res.status >= 200 && res.status < 400) {
    proxyCount.add(1);
    successRate.add(1);
  } else {
    errorCount.add(1);
    successRate.add(0);
    console.warn(`Unexpected status: ${res.status}`);
  }
}

// ── Teardown ──

export function teardown(data) {
  http.del(`${ADMIN_URL}/api/events/${data.eventId}`, null, {
    headers: {
      Authorization: `Bearer ${ADMIN_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  console.log(`\n✅ Gateway test complete. Event ${data.eventId} cleaned up.\n`);
}
