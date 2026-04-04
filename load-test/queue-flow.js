// ============================================================
// k6 Load Test — Full Queue WebSocket Flow
//
// Tests the complete visitor lifecycle under load:
//   1. Setup: Create a test event via admin API
//   2. Load: N virtual users connect via WebSocket, join queue
//   3. Wait: Users stay connected until released (or timeout)
//   4. Teardown: Delete the test event
//
// Usage:
//   # Start both workers locally first:
//   npm run dev          # terminal 1 (port 8787)
//   npm run dev:admin    # terminal 2 (port 8788)
//
//   # Run load test (default: 50 users, 60/min release rate):
//   k6 run load-test/queue-flow.js
//
//   # Custom parameters:
//   k6 run load-test/queue-flow.js \
//     --env VISITORS=200 \
//     --env RELEASE_RATE=120 \
//     --env WORKER_URL=http://localhost:8787 \
//     --env ADMIN_URL=http://localhost:8788 \
//     --env ADMIN_API_KEY=test-admin-key
//
//   # Against deployed workers:
//   k6 run load-test/queue-flow.js \
//     --env WORKER_URL=https://ticket.ironcode.cloud \
//     --env ADMIN_URL=https://your-admin.workers.dev \
//     --env ADMIN_API_KEY=your-real-key
// ============================================================

import ws from "k6/ws";
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend, Rate, Gauge } from "k6/metrics";

// ── Configuration ──

const WORKER_URL = __ENV.WORKER_URL || "http://localhost:8787";
const ADMIN_URL = __ENV.ADMIN_URL || "http://localhost:8788";
const ADMIN_API_KEY = __ENV.ADMIN_API_KEY || "test-admin-key";
const VISITORS = parseInt(__ENV.VISITORS || "50", 10);
const RELEASE_RATE = parseInt(__ENV.RELEASE_RATE || "60", 10);
const EVENT_ID = `loadtest-${Date.now()}`;
const MAX_WAIT_SECONDS = parseInt(__ENV.MAX_WAIT || "300", 10); // 5 min max

// ── Custom Metrics ──

const wsConnectTime = new Trend("ws_connect_time", true);       // ms to establish WS
const timeToPosition = new Trend("time_to_position", true);      // ms from connect to first position msg
const timeToRelease = new Trend("time_to_release", true);        // ms from join to release
const positionReceived = new Counter("position_messages");        // total position messages
const releaseReceived = new Counter("release_messages");          // total releases
const errorReceived = new Counter("error_messages");              // total error messages
const releaseRate = new Rate("released_visitors");                // % of visitors that got released
const queueFullCount = new Counter("queue_full_events");          // capacity hits
const activeConnections = new Gauge("active_ws_connections");     // current open WS

// ── k6 Options ──

export const options = {
  scenarios: {
    queue_visitors: {
      executor: "shared-iterations",
      vus: VISITORS,
      iterations: VISITORS,
      maxDuration: `${MAX_WAIT_SECONDS + 30}s`,
    },
  },
  thresholds: {
    ws_connect_time: ["p(95)<2000"],          // 95% connect under 2s
    time_to_position: ["p(95)<3000"],          // 95% get position under 3s
    released_visitors: [`rate>0.9`],           // >90% of visitors get released
    error_messages: ["count<5"],               // fewer than 5 errors
  },
};

// ── Setup: Create test event ──

export function setup() {
  console.log(`\n🎯 Load Test Configuration:`);
  console.log(`   Event ID:     ${EVENT_ID}`);
  console.log(`   Visitors:     ${VISITORS}`);
  console.log(`   Release Rate: ${RELEASE_RATE}/min`);
  console.log(`   Worker URL:   ${WORKER_URL}`);
  console.log(`   Admin URL:    ${ADMIN_URL}`);
  console.log(`   Max Wait:     ${MAX_WAIT_SECONDS}s\n`);

  // Create the test event
  const res = http.post(
    `${ADMIN_URL}/api/events`,
    JSON.stringify({
      eventId: EVENT_ID,
      name: `Load Test ${new Date().toISOString()}`,
      protectedPaths: [`/loadtest/*`],
      originUrl: "https://httpbin.org",
      releaseRate: RELEASE_RATE,
      tokenTtlSeconds: 600,
      failMode: "closed",
      maxQueueSize: 0, // unlimited
    }),
    {
      headers: {
        Authorization: `Bearer ${ADMIN_API_KEY}`,
        "Content-Type": "application/json",
      },
    },
  );

  const created = check(res, {
    "event created (201)": (r) => r.status === 201,
  });

  if (!created) {
    console.error(`Failed to create event: ${res.status} ${res.body}`);
    // Try to continue if event already exists
    if (res.status !== 400) {
      throw new Error(`Cannot create test event: ${res.status}`);
    }
  }

  const expectedDuration = Math.ceil((VISITORS / RELEASE_RATE) * 60);
  console.log(`   Expected release time: ~${expectedDuration}s for all ${VISITORS} visitors\n`);

  return { eventId: EVENT_ID };
}

// ── Main: Each VU connects via WebSocket and waits for release ──

export default function (data) {
  const eventId = data.eventId;
  const wsUrl = WORKER_URL.replace("http://", "ws://").replace("https://", "wss://");
  const connectStart = Date.now();
  let positionTime = null;
  let released = false;
  let myPosition = null;
  let myVisitorId = null;

  activeConnections.add(1);

  const res = ws.connect(
    `${wsUrl}/queue/ws?event=${encodeURIComponent(eventId)}`,
    null,
    function (socket) {
      const wsConnected = Date.now();
      wsConnectTime.add(wsConnected - connectStart);

      socket.on("open", function () {
        // Send join message (no existing visitorId — new visitor each time)
        socket.send(JSON.stringify({ type: "join" }));
      });

      socket.on("message", function (msg) {
        let data;
        try {
          data = JSON.parse(msg);
        } catch (e) {
          return;
        }

        switch (data.type) {
          case "position":
            positionReceived.add(1);
            if (positionTime === null) {
              positionTime = Date.now();
              timeToPosition.add(positionTime - connectStart);
            }
            myPosition = data.position;
            myVisitorId = data.visitorId;
            break;

          case "released":
            releaseReceived.add(1);
            releaseRate.add(1);
            released = true;
            timeToRelease.add(Date.now() - connectStart);

            // Verify the token is a valid JWT (3 segments)
            if (data.token) {
              const segments = data.token.split(".");
              check(segments, {
                "released token is valid JWT": (s) => s.length === 3,
              });
            }

            socket.close();
            break;

          case "error":
            errorReceived.add(1);
            console.warn(
              `VU ${__VU}: error code=${data.code} msg=${data.message}`,
            );
            if (
              data.code === "EVENT_NOT_FOUND" ||
              data.code === "EVENT_INACTIVE"
            ) {
              socket.close();
            }
            break;

          case "queue_full":
            queueFullCount.add(1);
            console.warn(
              `VU ${__VU}: queue full (${data.currentSize}/${data.maxSize})`,
            );
            socket.close();
            break;

          case "paused":
            // Queue paused, keep waiting
            break;

          case "pong":
            // Heartbeat ack, no-op
            break;
        }
      });

      socket.on("close", function () {
        if (!released) {
          releaseRate.add(0); // mark as NOT released
        }
      });

      socket.on("error", function (e) {
        console.error(`VU ${__VU}: WebSocket error: ${e.error()}`);
        errorReceived.add(1);
      });

      // Send heartbeat pings every 30s (like the real client)
      socket.setInterval(function () {
        socket.send(JSON.stringify({ type: "ping" }));
      }, 30000);

      // Timeout: close after MAX_WAIT_SECONDS if not released
      socket.setTimeout(function () {
        if (!released) {
          console.warn(
            `VU ${__VU}: timed out after ${MAX_WAIT_SECONDS}s (position: ${myPosition})`,
          );
          socket.close();
        }
      }, MAX_WAIT_SECONDS * 1000);
    },
  );

  activeConnections.add(-1);

  check(res, {
    "WebSocket connected (101)": (r) => r && r.status === 101,
  });
}

// ── Teardown: Delete test event ──

export function teardown(data) {
  const res = http.del(`${ADMIN_URL}/api/events/${data.eventId}`, null, {
    headers: {
      Authorization: `Bearer ${ADMIN_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  check(res, {
    "event deleted (200)": (r) => r.status === 200,
  });

  console.log(`\n✅ Load test complete. Event ${data.eventId} cleaned up.\n`);
}
