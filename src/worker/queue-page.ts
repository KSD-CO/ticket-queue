// ============================================================
// Queue page handler — serves the waiting room
//
// Flow:
//   1. Visitor redirected here by gateway (no valid token)
//   2. Serve queue.html (from static assets or inline)
//   3. queue.js opens WebSocket to DO via /queue/ws
//   4. DO assigns position, pushes updates
//   5. When released, client receives token and redirects
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

  // Try to serve from static assets first
  try {
    const assetResponse = await c.env.ASSETS.fetch(
      new Request(new URL("/queue.html", c.req.url)),
    );
    if (assetResponse.ok) {
      // Inject event ID and return URL into the HTML
      let html = await assetResponse.text();
      html = html.replace("{{EVENT_ID}}", eventId);
      html = html.replace("{{RETURN_URL}}", encodeURIComponent(returnUrl));
      return c.html(html);
    }
  } catch {
    // Fall through to inline HTML
  }

  // Inline fallback queue page
  return c.html(getInlineQueuePage(eventId, returnUrl));
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

  if (!eventId) {
    return c.json({ error: "Missing event parameter" }, 400);
  }

  // Route to DO for stats
  const doId = c.env.QUEUE_DO.idFromName(eventId);
  const doStub = c.env.QUEUE_DO.get(doId);

  const statsUrl = new URL(c.req.url);
  statsUrl.pathname = "/stats";

  const response = await doStub.fetch(new Request(statsUrl.toString()));
  return response;
}

function getInlineQueuePage(eventId: string, returnUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Waiting Room</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      max-width: 480px;
      padding: 2rem;
    }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; color: #f8fafc; }
    .position {
      font-size: 4rem;
      font-weight: 700;
      color: #3b82f6;
      margin: 1.5rem 0;
    }
    .label { font-size: 0.875rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em; }
    .eta { font-size: 1.25rem; margin-top: 1rem; color: #cbd5e1; }
    .progress-bar {
      width: 100%;
      height: 4px;
      background: #1e293b;
      border-radius: 2px;
      margin-top: 2rem;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: #3b82f6;
      border-radius: 2px;
      transition: width 0.5s ease;
      width: 0%;
    }
    .status { margin-top: 1rem; font-size: 0.875rem; color: #64748b; }
    .error { color: #ef4444; }
    .released { color: #22c55e; font-size: 1.25rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>You're in the queue</h1>
    <p class="label">Your position</p>
    <div class="position" id="position">--</div>
    <p class="label" id="ahead-label">People ahead of you</p>
    <div class="eta" id="eta">Calculating wait time...</div>
    <div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
    <p class="status" id="status">Connecting...</p>
  </div>

  <script>
    const EVENT_ID = "${eventId}";
    const RETURN_URL = decodeURIComponent("${encodeURIComponent(returnUrl)}");
    const COOKIE_NAME = "__queue_token";
    const VISITOR_ID_KEY = "queue_visitor_" + EVENT_ID;

    let ws = null;
    let reconnectAttempts = 0;
    let initialPosition = null;

    function connect() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const url = proto + "//" + location.host + "/queue/ws?event=" + EVENT_ID;
      ws = new WebSocket(url);

      ws.onopen = function() {
        document.getElementById("status").textContent = "Connected";
        reconnectAttempts = 0;

        const visitorId = localStorage.getItem(VISITOR_ID_KEY);
        ws.send(JSON.stringify({ type: "join", visitorId: visitorId || undefined }));
      };

      ws.onmessage = function(e) {
        const msg = JSON.parse(e.data);

        switch (msg.type) {
          case "position":
            localStorage.setItem(VISITOR_ID_KEY, msg.visitorId);
            if (initialPosition === null) initialPosition = msg.position;
            document.getElementById("position").textContent = msg.position;
            document.getElementById("ahead-label").textContent =
              msg.totalAhead === 0 ? "You're next!" : msg.totalAhead + " people ahead of you";
            if (msg.estimatedWaitSeconds >= 0) {
              const mins = Math.ceil(msg.estimatedWaitSeconds / 60);
              document.getElementById("eta").textContent =
                mins <= 1 ? "Less than a minute" : "About " + mins + " minutes";
            } else {
              document.getElementById("eta").textContent = "Queue is paused";
            }
            // Progress bar
            if (initialPosition && initialPosition > 1) {
              const pct = Math.max(0, Math.min(100, ((initialPosition - msg.position) / initialPosition) * 100));
              document.getElementById("progress").style.width = pct + "%";
            }
            break;

          case "released":
            document.getElementById("position").textContent = "✓";
            document.getElementById("position").classList.add("released");
            document.getElementById("ahead-label").textContent = "";
            document.getElementById("eta").textContent = "Redirecting...";
            document.getElementById("status").textContent = "You're in!";
            // Set token cookie
            document.cookie = COOKIE_NAME + "=" + msg.token + ";path=/;secure;samesite=lax;max-age=3600";
            // Redirect to protected page
            setTimeout(function() { location.href = RETURN_URL; }, 500);
            break;

          case "paused":
            document.getElementById("eta").textContent = msg.message || "Queue is temporarily paused";
            break;

          case "queue_full":
            document.getElementById("position").textContent = "Full";
            document.getElementById("eta").textContent = "Queue is at capacity. Please try again later.";
            document.getElementById("status").textContent = "";
            break;

          case "error":
            document.getElementById("status").textContent = msg.message;
            document.getElementById("status").classList.add("error");
            break;

          case "pong":
            break;
        }
      };

      ws.onclose = function() {
        document.getElementById("status").textContent = "Reconnecting...";
        reconnectAttempts++;
        var delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        setTimeout(connect, delay);
      };

      ws.onerror = function() {
        // onclose will fire after this
      };

      // Heartbeat
      setInterval(function() {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 30000);
    }

    connect();
  </script>
</body>
</html>`;
}
