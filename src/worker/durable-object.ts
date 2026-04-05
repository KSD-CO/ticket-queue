// ============================================================
// QueueDurableObject — The brain of the ticket queue system
//
// One instance per event. Manages all visitors for that event.
// Uses SQLite for persistence and WebSocket Hibernation for
// real-time position updates without idle billing.
//
// ┌─────────────────── STATE MACHINE ───────────────────────┐
// │                                                         │
// │  IDLE ──(config loaded + enabled)──▶ ACTIVE             │
// │    ▲                                   │                │
// │    │                          visitor connects via WS   │
// │    │                                   ▼                │
// │    │                               QUEUEING             │
// │    │                               │       │            │
// │    │                     visitor    │       │  alarm     │
// │    │                     joins     │       │  fires     │
// │    │                               │       │            │
// │    │                    assign     release N visitors    │
// │    │                    position   sign JWT + WS push   │
// │    │                               │       │            │
// │    │                               ▼       ▼            │
// │    │                         last visitor released      │
// │    │                                   │                │
// │    └────────────── ACTIVE ◀────────────┘                │
// │                      │                                  │
// │           enabled=false or event ended                  │
// │                      ▼                                  │
// │                  DRAINING ──(all released)──▶ COMPLETE   │
// └─────────────────────────────────────────────────────────┘
//
// SQLite schema:
//   visitors(
//     visitor_id    TEXT PRIMARY KEY,
//     position      INTEGER NOT NULL,
//     joined_at     INTEGER NOT NULL,  -- Unix timestamp ms
//     released_at   INTEGER,           -- NULL if still waiting
//     disconnected  INTEGER DEFAULT 0, -- 1 if WS disconnected
//     token         TEXT               -- JWT if released
//   )
//
// Alarm-based release:
//   Every ALARM_INTERVAL_MS (1s), the alarm fires and releases
//   ceil(releaseRate / 60) visitors from the front of the queue.
//   Each released visitor receives a signed JWT via WebSocket.
// ============================================================

import { DurableObject } from "cloudflare:workers";
import {
  ALARM_INTERVAL_MS,
  DISCONNECT_GRACE_SECONDS,
  MAX_VISITORS_PER_DO,
  SIGNING_KEY_PREFIX,
  EVENT_CONFIG_PREFIX,
  DEFAULT_MAX_CONCURRENT_RELEASES,
  TOKEN_GRACE_PERIOD_SECONDS,
  QUEUE_COUNT_PREFIX,
  QUEUE_COUNT_TTL_SECONDS,
} from "../shared/constants.js";
import { signToken, type QueueTokenClaims } from "../shared/jwt.js";
import {
  parseClientMessage,
  serializeServerMessage,
  type ServerMessage,
} from "../shared/messages.js";
import type { EventConfig } from "../shared/config.js";

/** Generate a short HMAC-based poll token for a visitor (for HTTP polling authentication) */
async function generatePollToken(visitorId: string, signingKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode("poll:" + visitorId));
  // Return first 16 bytes as hex for a compact token
  const bytes = new Uint8Array(sig).slice(0, 16);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Verify a poll token for a visitor */
async function verifyPollToken(visitorId: string, token: string, signingKey: string): Promise<boolean> {
  const expected = await generatePollToken(visitorId, signingKey);
  // Constant-time comparison
  if (token.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < token.length; i++) {
    result |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return result === 0;
}

interface Env {
  CONFIG_KV: KVNamespace;
  QUEUE_DO: DurableObjectNamespace;
}

/** Internal visitor record stored in SQLite */
interface VisitorRecord {
  visitor_id: string;
  position: number;
  joined_at: number;
  released_at: number | null;
  disconnected: number;
  token: string | null;
}

export class QueueDurableObject extends DurableObject<Env> {
  private config: EventConfig | null = null;
  private signingKey: string | null = null;
  private nextPosition: number = 1;
  private initialized = false;

  // ── Initialization ──

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    // Create SQLite table if not exists
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS visitors (
        visitor_id    TEXT PRIMARY KEY,
        position      INTEGER NOT NULL,
        joined_at     INTEGER NOT NULL,
        released_at   INTEGER,
        disconnected  INTEGER DEFAULT 0,
        token         TEXT
      )
    `);

    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_visitors_position
      ON visitors(position) WHERE released_at IS NULL
    `);

    // Load next position from existing data
    const result = this.ctx.storage.sql.exec(
      "SELECT MAX(position) as max_pos FROM visitors",
    ).toArray();
    const maxPos = (result[0] as { max_pos: number | null } | undefined)?.max_pos;
    this.nextPosition = (maxPos ?? 0) + 1;

    this.initialized = true;
  }

  private async loadConfig(eventId: string): Promise<EventConfig | null> {
    if (this.config?.eventId === eventId) return this.config;

    try {
      const raw = await this.env.CONFIG_KV.get(`${EVENT_CONFIG_PREFIX}${eventId}`);
      if (!raw) return null;

      this.config = JSON.parse(raw) as EventConfig;
      return this.config;
    } catch (e) {
      console.error(`[QueueDO] Failed to load config for event ${eventId}:`, e);
      // Rethrow so callers can distinguish KV errors from missing config
      throw e;
    }
  }

  private async loadSigningKey(eventId: string): Promise<string | null> {
    if (this.signingKey) return this.signingKey;

    const raw = await this.env.CONFIG_KV.get(`${SIGNING_KEY_PREFIX}${eventId}`);
    if (!raw) return null;

    // Support both legacy (plain string) and new (JSON array) formats
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        // New format: array of {key, active, createdAt} — use the active key for signing
        const active = (parsed as { key: string; active: boolean }[]).find((k) => k.active);
        if (active) {
          this.signingKey = active.key;
          return this.signingKey;
        }
        // No active key — use the last one as fallback
        const last = parsed[parsed.length - 1] as { key: string } | undefined;
        this.signingKey = last?.key ?? null;
        return this.signingKey;
      }
    } catch {
      // Not JSON — treat as legacy plain string key
    }

    // Legacy format: plain string
    this.signingKey = raw;
    return this.signingKey;
  }

  // ── HTTP handler (stats, config reload) ──

  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized();

    const url = new URL(request.url);

    // Persist the event ID from the query string so the DO knows which event it serves.
    // This is set by the queue-page handler when forwarding requests to the DO.
    // Always reload config (not just when this.config is null) because in-memory
    // state is lost when the DO wakes from hibernation.
    const eventIdParam = url.searchParams.get("event");
    if (eventIdParam) {
      await this.setEventId(eventIdParam);
      try {
        this.config = null; // Force reload from KV
        await this.loadConfig(eventIdParam);
      } catch {
        // KV error during fetch — config will be retried in handleJoin/alarm
      }
    }

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request);
    }

    // Stats endpoint (called by admin Worker)
    if (url.pathname === "/stats") {
      return this.handleStats();
    }

    // Individual visitor status (called by poll endpoint with HMAC auth)
    if (url.pathname === "/visitor-status") {
      return this.handleVisitorStatus(url);
    }

    // Reload config
    if (url.pathname === "/reload-config") {
      const eventId = url.searchParams.get("eventId");
      if (eventId) {
        this.config = null;
        this.signingKey = null;
        await this.loadConfig(eventId);
      }
      return new Response("OK");
    }

    return new Response("Not Found", { status: 404 });
  }

  // ── WebSocket Hibernation handlers ──

  private handleWebSocketUpgrade(_request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Accept with hibernation — DO won't be billed while idle
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ensureInitialized();

    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    const msg = parseClientMessage(raw);

    if (!msg) {
      this.sendToSocket(ws, {
        type: "error",
        code: "INVALID_MESSAGE",
        message: "Could not parse message",
      });
      return;
    }

    switch (msg.type) {
      case "join":
        await this.handleJoin(ws, msg.visitorId, msg.turnstileToken);
        break;
      case "ping":
        this.sendToSocket(ws, { type: "pong" });
        break;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    await this.ensureInitialized();

    // Find visitor by this WebSocket's attachment
    const visitorId = this.getVisitorIdFromSocket(ws);
    if (!visitorId) return;

    // Mark as disconnected but keep position (grace period)
    this.ctx.storage.sql.exec(
      "UPDATE visitors SET disconnected = 1 WHERE visitor_id = ? AND released_at IS NULL",
      visitorId,
    );

    console.log(`[QueueDO] Visitor ${visitorId} disconnected (code: ${code}), position preserved`);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const visitorId = this.getVisitorIdFromSocket(ws);
    console.error(`[QueueDO] WebSocket error for visitor ${visitorId ?? "unknown"}:`, error);
  }

  // ── Join logic ──

  private async handleJoin(ws: WebSocket, existingVisitorId?: string, turnstileToken?: string): Promise<void> {
    // Get event ID from the first tag or a stored value
    const eventId = this.getEventId();
    if (!eventId) {
      this.sendToSocket(ws, { type: "error", code: "EVENT_NOT_FOUND", message: "No event configured" });
      return;
    }

    let config: EventConfig | null;
    try {
      config = await this.loadConfig(eventId);
    } catch {
      // KV transient error — tell client to retry rather than showing a hard error
      this.sendToSocket(ws, {
        type: "error",
        code: "TEMPORARY_ERROR",
        message: "Temporary error loading event configuration. Please refresh the page.",
      });
      return;
    }

    if (!config) {
      this.sendToSocket(ws, { type: "error", code: "EVENT_NOT_FOUND", message: "Event configuration not found" });
      return;
    }

    if (!config.enabled) {
      this.sendToSocket(ws, { type: "error", code: "EVENT_INACTIVE", message: "Event is not active" });
      return;
    }

    // Check schedule — reject joins if event has not started or has ended
    if (config.eventStartTime) {
      const start = new Date(config.eventStartTime).getTime();
      if (!isNaN(start) && Date.now() < start) {
        this.sendToSocket(ws, { type: "error", code: "EVENT_INACTIVE", message: "Event has not started yet" });
        return;
      }
    }
    if (config.eventEndTime) {
      const end = new Date(config.eventEndTime).getTime();
      if (!isNaN(end) && Date.now() > end) {
        this.sendToSocket(ws, { type: "error", code: "EVENT_INACTIVE", message: "Event has ended" });
        return;
      }
    }

    // Verify Cloudflare Turnstile token if enabled
    if (config.turnstileEnabled && config.turnstileSecretKey) {
      if (!turnstileToken) {
        this.sendToSocket(ws, { type: "error", code: "TURNSTILE_REQUIRED", message: "Verification required" });
        return;
      }
      const turnstileOk = await this.verifyTurnstile(turnstileToken, config.turnstileSecretKey);
      if (!turnstileOk) {
        this.sendToSocket(ws, { type: "error", code: "TURNSTILE_FAILED", message: "Verification failed. Please try again." });
        return;
      }
    }

    // Check for reconnection
    if (existingVisitorId) {
      const existing = this.ctx.storage.sql.exec(
        "SELECT * FROM visitors WHERE visitor_id = ? AND released_at IS NULL",
        existingVisitorId,
      ).toArray() as unknown as VisitorRecord[];

      if (existing.length > 0) {
        const visitor = existing[0]!;
        // Restore connection
        this.ctx.storage.sql.exec(
          "UPDATE visitors SET disconnected = 0 WHERE visitor_id = ?",
          existingVisitorId,
        );

        // Tag this WebSocket with the visitor ID
        ws.serializeAttachment(existingVisitorId);

        // Send current position
        const position = this.getQueuePosition(visitor.position);
        this.sendToSocket(ws, {
          type: "position",
          visitorId: existingVisitorId,
          position: position.relativePosition,
          totalAhead: position.totalAhead,
          estimatedWaitSeconds: this.estimateWaitSeconds(position.totalAhead),
        });

        console.log(`[QueueDO] Visitor ${existingVisitorId} reconnected at position ${position.relativePosition}`);
        return;
      }

      // If visitor already released, check for stored token
      const releasedRows = this.ctx.storage.sql.exec(
        "SELECT * FROM visitors WHERE visitor_id = ? AND released_at IS NOT NULL",
        existingVisitorId,
      ).toArray() as unknown as VisitorRecord[];

      if (releasedRows.length > 0 && releasedRows[0]?.token) {
        const storedToken = releasedRows[0].token;
        // Check if the stored token is still valid (not expired past grace period)
        const now = Math.floor(Date.now() / 1000);
        let tokenStillValid = false;
        try {
          const payloadB64 = storedToken.split(".")[1];
          if (payloadB64) {
            const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))) as QueueTokenClaims;
            tokenStillValid = now <= payload.exp + TOKEN_GRACE_PERIOD_SECONDS;
          }
        } catch {
          // Can't parse token — treat as expired
        }

        if (tokenStillValid) {
          const maxAge = config.tokenTtlSeconds + TOKEN_GRACE_PERIOD_SECONDS;
          this.sendToSocket(ws, { type: "released", token: storedToken, maxAge });
          return;
        }

        // Token expired — re-sign a fresh token for this visitor
        const eventId = this.getEventId();
        if (eventId && config) {
          const secret = await this.loadSigningKey(eventId);
          if (secret) {
            const visitor = releasedRows[0]!;
            const freshClaims: QueueTokenClaims = {
              sub: visitor.visitor_id,
              evt: eventId,
              iat: now,
              exp: now + config.tokenTtlSeconds,
              pos: visitor.position,
            };
            const freshToken = await signToken(freshClaims, secret);

            // Update stored token in DB
            this.ctx.storage.sql.exec(
              "UPDATE visitors SET token = ? WHERE visitor_id = ?",
              freshToken,
              existingVisitorId,
            );

            this.sendToSocket(ws, { type: "released", token: freshToken, maxAge: config.tokenTtlSeconds + TOKEN_GRACE_PERIOD_SECONDS });
            console.log(`[QueueDO] Re-issued fresh token for previously released visitor ${existingVisitorId}`);
            return;
          }
        }

        // Fallback: can't re-sign, send the old token anyway (best effort)
        this.sendToSocket(ws, { type: "released", token: storedToken });
        return;
      }
    }

    // New visitor — check capacity
    const currentCount = this.getActiveVisitorCount();
    const maxSize = config.maxQueueSize > 0 ? config.maxQueueSize : MAX_VISITORS_PER_DO;

    if (currentCount >= maxSize) {
      this.sendToSocket(ws, {
        type: "queue_full",
        currentSize: currentCount,
        maxSize,
      });
      return;
    }

    // Assign position
    const visitorId = existingVisitorId ?? crypto.randomUUID();
    const position = this.nextPosition++;
    const now = Date.now();

    try {
      this.ctx.storage.sql.exec(
        "INSERT INTO visitors (visitor_id, position, joined_at) VALUES (?, ?, ?)",
        visitorId,
        position,
        now,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("SQLITE_FULL")) {
        this.sendToSocket(ws, { type: "error", code: "STORAGE_FULL", message: "Queue storage full" });
        return;
      }
      throw e;
    }

    // Tag WebSocket with visitor ID
    ws.serializeAttachment(visitorId);

    // Send initial position (with poll token for HTTP polling fallback)
    const queuePos = this.getQueuePosition(position);
    let pollToken: string | undefined;
    const secret = await this.loadSigningKey(eventId);
    if (secret) {
      pollToken = await generatePollToken(visitorId, secret);
    }
    this.sendToSocket(ws, {
      type: "position",
      visitorId,
      position: queuePos.relativePosition,
      totalAhead: queuePos.totalAhead,
      estimatedWaitSeconds: this.estimateWaitSeconds(queuePos.totalAhead),
      pollToken,
    });

    // Ensure alarm is scheduled for releases
    await this.ensureAlarmScheduled();

    console.log(`[QueueDO] Visitor ${visitorId} joined at position ${position} (queue size: ${currentCount + 1})`);
  }

  // ── Alarm: release visitors at configured rate ──

  async alarm(): Promise<void> {
    await this.ensureInitialized();

    const eventId = this.getEventId();
    if (!eventId) return;

    // Always reschedule if there are visitors waiting, even if config
    // temporarily fails to load (KV eventual consistency / transient errors).
    // This prevents visitors from being permanently stuck in the queue.
    const activeCount = this.getActiveVisitorCount();
    const shouldReschedule = activeCount > 0;

    let config: EventConfig | null;
    try {
      config = await this.loadConfig(eventId);
    } catch {
      // KV transient error — reschedule to retry later
      console.error(`[QueueDO] Alarm: failed to load config for ${eventId}, will retry`);
      if (shouldReschedule) {
        await this.ensureAlarmScheduled();
      }
      return;
    }

    if (!config || !config.enabled) {
      if (shouldReschedule) {
        await this.ensureAlarmScheduled();
      }
      return;
    }

    // Check if event has ended — stop releasing but keep alarm for draining
    if (config.eventEndTime) {
      const end = new Date(config.eventEndTime).getTime();
      if (!isNaN(end) && Date.now() > end) {
        console.log(`[QueueDO] Event ${eventId} has ended, stopping releases`);
        this.broadcastToAll({ type: "error", code: "EVENT_INACTIVE", message: "Event has ended" });
        return; // Stop alarm — no more releases
      }
    }

    // Clean up disconnected visitors past grace period
    this.cleanupDisconnected();

    const releaseRate = config.releaseRate;
    if (releaseRate <= 0) {
      // Queue is paused — broadcast paused state and reschedule
      this.broadcastToAll({ type: "paused", message: "Queue is temporarily paused" });
      await this.ensureAlarmScheduled();
      return;
    }

    // Calculate batch size: releaseRate is per minute, alarm fires every second.
    // Cap at DEFAULT_MAX_CONCURRENT_RELEASES to prevent origin stampede — even if
    // releaseRate is very high, we never release more than this many per tick.
    const batchSize = Math.min(
      Math.max(1, Math.ceil(releaseRate / 60)),
      DEFAULT_MAX_CONCURRENT_RELEASES,
    );

    // Get next visitors to release (FIFO by position)
    const toRelease = this.ctx.storage.sql.exec(
      "SELECT * FROM visitors WHERE released_at IS NULL AND disconnected = 0 ORDER BY position ASC LIMIT ?",
      batchSize,
    ).toArray() as unknown as VisitorRecord[];

    if (toRelease.length > 0) {
      const secret = await this.loadSigningKey(eventId);
      if (!secret) {
        console.error(`[QueueDO] No signing key for event ${eventId}, cannot release visitors`);
        await this.ensureAlarmScheduled();
        return;
      }

      for (const visitor of toRelease) {
        await this.releaseVisitor(visitor, config, secret);
      }
    }

    // Broadcast updated positions to all remaining visitors
    this.broadcastPositionUpdates();

    // Publish active visitor count to KV for gateway threshold mode.
    // Uses a short TTL so the key auto-expires if the DO stops running.
    if (config.mode === "threshold") {
      const count = this.getActiveVisitorCount();
      try {
        await this.env.CONFIG_KV.put(
          `${QUEUE_COUNT_PREFIX}${eventId}`,
          String(count),
          { expirationTtl: QUEUE_COUNT_TTL_SECONDS },
        );
      } catch (e) {
        console.error(`[QueueDO] Failed to publish queue count to KV:`, e);
      }
    }

    // Reschedule if there are still visitors waiting
    if (shouldReschedule) {
      await this.ensureAlarmScheduled();
    }
  }

  private async releaseVisitor(
    visitor: VisitorRecord,
    config: EventConfig,
    secret: string,
  ): Promise<void> {
    const claims: QueueTokenClaims = {
      sub: visitor.visitor_id,
      evt: config.eventId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + config.tokenTtlSeconds,
      pos: visitor.position,
    };

    const token = await signToken(claims, secret);
    const now = Date.now();

    // Update DB
    this.ctx.storage.sql.exec(
      "UPDATE visitors SET released_at = ?, token = ? WHERE visitor_id = ?",
      now,
      token,
      visitor.visitor_id,
    );

    // Send token via WebSocket (include maxAge for accurate cookie TTL)
    const ws = this.findSocketForVisitor(visitor.visitor_id);
    if (ws) {
      const maxAge = config.tokenTtlSeconds + TOKEN_GRACE_PERIOD_SECONDS;
      this.sendToSocket(ws, { type: "released", token, maxAge });
    }

    console.log(`[QueueDO] Released visitor ${visitor.visitor_id} (position ${visitor.position}), wait time: ${Math.round((now - visitor.joined_at) / 1000)}s`);
  }

  // ── Stats ──

  private handleStats(): Response {
    const activeCount = this.getActiveVisitorCount();
    const releasedCount = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) as cnt FROM visitors WHERE released_at IS NOT NULL",
    ).toArray()[0] as { cnt: number } | undefined;

    const totalCount = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) as cnt FROM visitors",
    ).toArray()[0] as { cnt: number } | undefined;

    const avgWait = this.ctx.storage.sql.exec(
      "SELECT AVG(released_at - joined_at) as avg_ms FROM visitors WHERE released_at IS NOT NULL",
    ).toArray()[0] as { avg_ms: number | null } | undefined;

    const wsConnections = this.ctx.getWebSockets().length;

    return Response.json({
      activeVisitors: activeCount,
      releasedVisitors: releasedCount?.cnt ?? 0,
      totalVisitors: totalCount?.cnt ?? 0,
      averageWaitMs: avgWait?.avg_ms ?? null,
      webSocketConnections: wsConnections,
    });
  }

  /** Handle individual visitor status for HTTP polling with HMAC auth */
  private async handleVisitorStatus(url: URL): Promise<Response> {
    const visitorId = url.searchParams.get("visitor_id");
    const pollToken = url.searchParams.get("poll_token");

    if (!visitorId || !pollToken) {
      return Response.json({ error: "Missing visitor_id or poll_token" }, { status: 400 });
    }

    // Verify the HMAC poll token
    const eventId = this.getEventId();
    if (!eventId) {
      return Response.json({ error: "No event configured" }, { status: 404 });
    }

    const signingKey = await this.loadSigningKey(eventId);
    if (!signingKey) {
      return Response.json({ error: "Signing key not available" }, { status: 500 });
    }

    const isValid = await verifyPollToken(visitorId, pollToken, signingKey);
    if (!isValid) {
      return Response.json({ error: "Invalid poll token" }, { status: 403 });
    }

    // Look up visitor
    const rows = this.ctx.storage.sql.exec(
      "SELECT * FROM visitors WHERE visitor_id = ?",
      visitorId,
    ).toArray() as unknown as VisitorRecord[];

    if (rows.length === 0) {
      return Response.json({ error: "Visitor not found" }, { status: 404 });
    }

    const visitor = rows[0]!;

    // Already released — return the token
    if (visitor.released_at !== null && visitor.token) {
      return Response.json({ status: "released", token: visitor.token });
    }

    // Still in queue — return position
    const pos = this.getQueuePosition(visitor.position);
    return Response.json({
      status: "waiting",
      position: pos.relativePosition,
      totalAhead: pos.totalAhead,
      estimatedWaitSeconds: this.estimateWaitSeconds(pos.totalAhead),
    });
  }

  // ── Helpers ──

  private getEventId(): string | null {
    // Event ID is stored as the DO name (derived from event ID in the gateway)
    // We extract it from the DO's id which was created with idFromName(eventId)
    // For now, load from config if available, or from storage
    if (this.config) return this.config.eventId;

    const stored = this.ctx.storage.sql.exec(
      "SELECT value FROM _meta WHERE key = 'event_id' LIMIT 1",
    );
    try {
      const rows = stored.toArray() as { value: string }[];
      return rows[0]?.value ?? null;
    } catch {
      // _meta table may not exist yet
      return null;
    }
  }

  /** Store the event ID so the DO knows which event it serves */
  async setEventId(eventId: string): Promise<void> {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT)",
    );
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO _meta (key, value) VALUES ('event_id', ?)",
      eventId,
    );
  }

  private getActiveVisitorCount(): number {
    const result = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) as cnt FROM visitors WHERE released_at IS NULL",
    ).toArray()[0] as { cnt: number } | undefined;
    return result?.cnt ?? 0;
  }

  private getQueuePosition(absolutePosition: number): { relativePosition: number; totalAhead: number } {
    const ahead = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) as cnt FROM visitors WHERE position < ? AND released_at IS NULL",
      absolutePosition,
    ).toArray()[0] as { cnt: number } | undefined;
    const totalAhead = ahead?.cnt ?? 0;
    return {
      relativePosition: totalAhead + 1,
      totalAhead,
    };
  }

  private estimateWaitSeconds(positionsAhead: number): number {
    const rate = this.config?.releaseRate ?? 60;
    if (rate <= 0) return -1; // paused
    return Math.ceil((positionsAhead / rate) * 60);
  }

  private sendToSocket(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(serializeServerMessage(msg));
    } catch (e) {
      console.error("[QueueDO] Failed to send WS message:", e);
    }
  }

  private getVisitorIdFromSocket(ws: WebSocket): string | null {
    try {
      return ws.deserializeAttachment() as string | null;
    } catch {
      return null;
    }
  }

  private findSocketForVisitor(visitorId: string): WebSocket | null {
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        const id = ws.deserializeAttachment() as string | null;
        if (id === visitorId) return ws;
      } catch {
        continue;
      }
    }
    return null;
  }

  private broadcastToAll(msg: ServerMessage): void {
    const serialized = serializeServerMessage(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(serialized);
      } catch {
        // Socket may be closed
      }
    }
  }

  private broadcastPositionUpdates(): void {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;

    // Single batch query: fetch all active (non-released) visitors at once.
    // This replaces the previous O(N) approach of one query per WebSocket.
    const activeVisitors = this.ctx.storage.sql.exec(
      "SELECT visitor_id, position FROM visitors WHERE released_at IS NULL ORDER BY position ASC",
    ).toArray() as { visitor_id: string; position: number }[];

    // Build a map from visitor_id → absolute position
    const positionMap = new Map<string, number>();
    for (const v of activeVisitors) {
      positionMap.set(v.visitor_id, v.position);
    }

    // Pre-compute relative positions: since activeVisitors is sorted by position ASC,
    // the relative position (1-based) is simply the index + 1.
    const relativeMap = new Map<string, { relativePosition: number; totalAhead: number }>();
    for (let i = 0; i < activeVisitors.length; i++) {
      const v = activeVisitors[i]!;
      relativeMap.set(v.visitor_id, {
        relativePosition: i + 1,
        totalAhead: i,
      });
    }

    for (const ws of sockets) {
      const visitorId = this.getVisitorIdFromSocket(ws);
      if (!visitorId) continue;

      const pos = relativeMap.get(visitorId);
      if (!pos) continue; // Already released or not found

      this.sendToSocket(ws, {
        type: "position",
        visitorId,
        position: pos.relativePosition,
        totalAhead: pos.totalAhead,
        estimatedWaitSeconds: this.estimateWaitSeconds(pos.totalAhead),
      });
    }
  }

  /**
   * Verify a Cloudflare Turnstile token via the siteverify API.
   * Fails open: if the API is unreachable or errors, returns true (allow visitor).
   */
  private async verifyTurnstile(token: string, secretKey: string): Promise<boolean> {
    try {
      const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret: secretKey, response: token }),
      });

      if (!response.ok) {
        // Turnstile API error — fail open
        console.error(`[QueueDO] Turnstile API returned ${response.status}, allowing visitor (fail-open)`);
        return true;
      }

      const result = (await response.json()) as { success: boolean };
      if (!result.success) {
        console.log("[QueueDO] Turnstile verification failed (invalid token)");
        return false;
      }
      return true;
    } catch (e) {
      // Network error / timeout — fail open
      console.error("[QueueDO] WARNING: Turnstile verification error, allowing visitor (fail-open):", e);
      return true;
    }
  }

  private cleanupDisconnected(): void {
    const cutoff = Date.now() - DISCONNECT_GRACE_SECONDS * 1000;
    const removed = this.ctx.storage.sql.exec(
      "DELETE FROM visitors WHERE disconnected = 1 AND joined_at < ? AND released_at IS NULL",
      cutoff,
    );
    // Log if any were cleaned up
    if (removed.rowsWritten > 0) {
      console.log(`[QueueDO] Cleaned up ${removed.rowsWritten} disconnected visitors past grace period`);
    }
  }

  private async ensureAlarmScheduled(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (!existing) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }
}
