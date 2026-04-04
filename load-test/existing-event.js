// ============================================================
// k6 Load Test — Existing Event (no setup/teardown)
//
// Runs against an already-configured event. Does not create
// or delete anything — purely load tests the queue flow.
//
// Usage:
//   k6 run load-test/existing-event.js \
//     --env EVENT_ID=neon-nights-2026 \
//     --env VISITORS=100 \
//     --env WORKER_URL=https://ticket.ironcode.cloud
// ============================================================

import ws from "k6/ws";
import http from "k6/http";
import { check } from "k6";
import { Counter, Trend, Rate, Gauge } from "k6/metrics";

// ── Configuration ──

const WORKER_URL = __ENV.WORKER_URL || "https://ticket.ironcode.cloud";
const EVENT_ID = __ENV.EVENT_ID || "neon-nights-2026";
const VISITORS = parseInt(__ENV.VISITORS || "50", 10);
const MAX_WAIT_SECONDS = parseInt(__ENV.MAX_WAIT || "300", 10);

// ── Custom Metrics ──

const wsConnectTime = new Trend("ws_connect_time", true);
const timeToPosition = new Trend("time_to_position", true);
const timeToRelease = new Trend("time_to_release", true);
const positionReceived = new Counter("position_messages");
const releaseReceived = new Counter("release_messages");
const errorReceived = new Counter("error_messages");
const releaseRate = new Rate("released_visitors");
const queueFullCount = new Counter("queue_full_events");
const activeConnections = new Gauge("active_ws_connections");

// ── k6 Options ──

// ── k6 Options ──
// When VISITORS > 500, use ramping-vus to stagger connections (avoids TLS thundering herd).
// Otherwise use shared-iterations for simplicity.

const USE_RAMPING = VISITORS > 500;

export const options = USE_RAMPING
  ? {
      scenarios: {
        queue_visitors: {
          executor: "ramping-vus",
          startVUs: 0,
          stages: [
            { duration: `${Math.ceil(VISITORS / 100)}s`, target: VISITORS }, // ramp up ~100 VUs/sec
            { duration: `${MAX_WAIT_SECONDS}s`, target: VISITORS },          // hold at max
          ],
          gracefulRampDown: "30s",
          gracefulStop: "30s",
        },
      },
      thresholds: {
        ws_connect_time: ["p(95)<10000"],
        time_to_position: ["p(95)<15000"],
        released_visitors: ["rate>0.8"],
        error_messages: ["count<50"],
      },
    }
  : {
      scenarios: {
        queue_visitors: {
          executor: "shared-iterations",
          vus: VISITORS,
          iterations: VISITORS,
          maxDuration: `${MAX_WAIT_SECONDS + 30}s`,
        },
      },
      thresholds: {
        ws_connect_time: ["p(95)<5000"],
        time_to_position: ["p(95)<6000"],
        released_visitors: ["rate>0.9"],
        error_messages: ["count<10"],
      },
    };

// ── Setup: just log config ──

export function setup() {
  console.log(`\n🎯 Load Test — Existing Event:`);
  console.log(`   Event ID:   ${EVENT_ID}`);
  console.log(`   Visitors:   ${VISITORS}`);
  console.log(`   Worker URL: ${WORKER_URL}`);
  console.log(`   Max Wait:   ${MAX_WAIT_SECONDS}s\n`);

  // Verify the worker is healthy
  const res = http.get(`${WORKER_URL}/health`);
  check(res, { "worker healthy": (r) => r.status === 200 });

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
            console.warn(`VU ${__VU}: error code=${data.code} msg=${data.message}`);
            if (data.code === "EVENT_NOT_FOUND" || data.code === "EVENT_INACTIVE") {
              socket.close();
            }
            break;

          case "queue_full":
            queueFullCount.add(1);
            console.warn(`VU ${__VU}: queue full (${data.currentSize}/${data.maxSize})`);
            socket.close();
            break;

          case "paused":
          case "pong":
            break;
        }
      });

      socket.on("close", function () {
        if (!released) {
          releaseRate.add(0);
        }
      });

      socket.on("error", function (e) {
        console.error(`VU ${__VU}: WebSocket error: ${e.error()}`);
        errorReceived.add(1);
      });

      // Heartbeat every 30s
      socket.setInterval(function () {
        socket.send(JSON.stringify({ type: "ping" }));
      }, 30000);

      // Timeout
      socket.setTimeout(function () {
        if (!released) {
          console.warn(`VU ${__VU}: timed out after ${MAX_WAIT_SECONDS}s (position: ${myPosition})`);
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

export function teardown() {
  console.log(`\n✅ Load test complete (event ${EVENT_ID} was NOT modified).\n`);
}
