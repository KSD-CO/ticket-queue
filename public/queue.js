// ============================================================
// Queue page client — WebSocket connection + UI updates
//
// Reads config from window.__QUEUE_CONFIG (injected by server).
// Opens WebSocket to the Durable Object, handles messages,
// manages reconnection with exponential backoff, and redirects
// the visitor when they're released from the queue.
//
// Falls back to HTTP polling if WebSocket fails 3 times.
// ============================================================

(function () {
  "use strict";

  // ── Config ──

  var config = window.__QUEUE_CONFIG || {};
  var EVENT_ID = config.eventId;
  var RETURN_URL = config.returnUrl || "/";
  var COOKIE_NAME = "__queue_token";
  var VISITOR_ID_KEY = "queue_visitor_" + EVENT_ID;
  var MAX_WS_FAILURES = 3;

  // ── DOM refs ──

  var elPosition = document.getElementById("position");
  var elAheadLabel = document.getElementById("ahead-label");
  var elEta = document.getElementById("eta");
  var elProgress = document.getElementById("progress");
  var elStatus = document.getElementById("status");
  var elStatusDot = document.getElementById("status-dot");

  // ── State ──

  var ws = null;
  var reconnectAttempts = 0;
  var wsFailures = 0;
  var initialPosition = null;
  var heartbeatTimer = null;
  var reconnectTimer = null;
  var useFallbackPolling = false;
  var pollTimer = null;
  var released = false;

  // ── Helpers ──

  function setStatus(text, state) {
    elStatus.textContent = text;
    elStatusDot.className = "status-dot " + (state || "");
  }

  function formatWait(seconds) {
    if (seconds < 0) return "Queue is paused";
    if (seconds <= 60) return "Less than a minute";
    var mins = Math.ceil(seconds / 60);
    if (mins === 1) return "About 1 minute";
    return "About " + mins + " minutes";
  }

  function getVisitorId() {
    try {
      return localStorage.getItem(VISITOR_ID_KEY);
    } catch (e) {
      return null;
    }
  }

  function setVisitorId(id) {
    try {
      localStorage.setItem(VISITOR_ID_KEY, id);
    } catch (e) {
      // localStorage may be unavailable (private browsing)
    }
  }

  function setCookie(name, value, maxAge) {
    var parts = [name + "=" + value, "path=/", "max-age=" + maxAge, "samesite=lax"];
    if (location.protocol === "https:") {
      parts.push("secure");
    }
    document.cookie = parts.join(";");
  }

  // ── UI update handlers ──

  function handlePosition(msg) {
    if (msg.visitorId) setVisitorId(msg.visitorId);
    if (initialPosition === null) initialPosition = msg.position;

    elPosition.textContent = msg.position;
    elPosition.className = "position-number";

    if (msg.totalAhead === 0) {
      elAheadLabel.textContent = "You're next!";
    } else if (msg.totalAhead === 1) {
      elAheadLabel.textContent = "1 person ahead of you";
    } else {
      elAheadLabel.textContent = msg.totalAhead + " people ahead of you";
    }

    elEta.textContent = formatWait(msg.estimatedWaitSeconds);
    elEta.className = msg.estimatedWaitSeconds < 0 ? "eta paused" : "eta";

    // Progress bar
    if (initialPosition && initialPosition > 1) {
      var pct = Math.max(0, Math.min(100,
        ((initialPosition - msg.position) / (initialPosition - 1)) * 100
      ));
      elProgress.style.width = pct + "%";
    }
  }

  function handleReleased(msg) {
    released = true;
    elPosition.textContent = "\u2713"; // checkmark
    elPosition.className = "position-number released";
    elAheadLabel.textContent = "";
    elEta.textContent = "Redirecting...";
    elProgress.style.width = "100%";
    setStatus("You're in!", "connected");

    // Set token cookie (1 hour)
    setCookie(COOKIE_NAME, msg.token, 3600);

    // Redirect after brief delay so user sees the success state
    setTimeout(function () {
      location.href = RETURN_URL;
    }, 600);
  }

  function handlePaused(msg) {
    elEta.textContent = msg.message || "Queue is temporarily paused";
    elEta.className = "eta paused";
  }

  function handleQueueFull(msg) {
    elPosition.textContent = "Full";
    elAheadLabel.textContent = "";
    elEta.textContent = "Queue is at capacity (" + msg.currentSize + "/" + msg.maxSize + "). Please try again later.";
    setStatus("Queue full", "error");
  }

  function handleError(msg) {
    setStatus(msg.message || "An error occurred", "error");
  }

  // ── WebSocket connection ──

  function connect() {
    if (released) return;

    cleanup();

    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    var url = proto + "//" + location.host + "/queue/ws?event=" + encodeURIComponent(EVENT_ID);

    try {
      ws = new WebSocket(url);
    } catch (e) {
      wsFailures++;
      scheduleReconnect();
      return;
    }

    ws.onopen = function () {
      setStatus("Connected", "connected");
      reconnectAttempts = 0;

      // Send join message
      var visitorId = getVisitorId();
      var msg = { type: "join" };
      if (visitorId) msg.visitorId = visitorId;
      ws.send(JSON.stringify(msg));

      // Start heartbeat
      heartbeatTimer = setInterval(function () {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 30000);
    };

    ws.onmessage = function (e) {
      var msg;
      try {
        msg = JSON.parse(e.data);
      } catch (err) {
        return;
      }

      switch (msg.type) {
        case "position":
          handlePosition(msg);
          break;
        case "released":
          handleReleased(msg);
          break;
        case "paused":
          handlePaused(msg);
          break;
        case "queue_full":
          handleQueueFull(msg);
          break;
        case "error":
          handleError(msg);
          break;
        case "pong":
          // heartbeat ack, no-op
          break;
      }
    };

    ws.onclose = function () {
      if (released) return;
      setStatus("Reconnecting...", "reconnecting");
      scheduleReconnect();
    };

    ws.onerror = function () {
      wsFailures++;
      // onclose fires after onerror
    };
  }

  function cleanup() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      try { ws.close(); } catch (e) { /* ignore */ }
      ws = null;
    }
  }

  function scheduleReconnect() {
    if (released) return;

    // Switch to polling after too many WS failures
    if (wsFailures >= MAX_WS_FAILURES && !useFallbackPolling) {
      useFallbackPolling = true;
      setStatus("Using fallback connection", "reconnecting");
      startPolling();
      return;
    }

    reconnectAttempts++;
    var delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    // Add jitter (0-25% of delay)
    delay += Math.random() * delay * 0.25;

    reconnectTimer = setTimeout(connect, delay);
  }

  // ── HTTP polling fallback ──

  function startPolling() {
    if (released) return;

    poll();
    pollTimer = setInterval(poll, 3000);
  }

  function poll() {
    if (released) return;

    var url = "/queue/poll?event=" + encodeURIComponent(EVENT_ID);
    var visitorId = getVisitorId();
    if (visitorId) url += "&visitor_id=" + encodeURIComponent(visitorId);

    fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.activeVisitors !== undefined) {
          setStatus("Connected (polling)", "connected");
          // Polling gives us aggregate stats, not individual position
          // Best effort: show queue size
          elAheadLabel.textContent = data.activeVisitors + " people in queue";
        }
      })
      .catch(function () {
        setStatus("Connection issues", "error");
      });
  }

  // ── Visibility API: reconnect when tab becomes visible ──

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && !released) {
      if (useFallbackPolling) {
        poll();
      } else if (!ws || ws.readyState !== WebSocket.OPEN) {
        connect();
      }
    }
  });

  // ── Init ──

  if (!EVENT_ID) {
    setStatus("Missing event configuration", "error");
    elEta.textContent = "Something went wrong. Please refresh or try again.";
  } else {
    connect();
  }
})();
