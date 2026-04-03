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
} from "../shared/constants.js";
import { signToken, type QueueTokenClaims } from "../shared/jwt.js";
import {
  parseClientMessage,
  serializeServerMessage,
  type ServerMessage,
} from "../shared/messages.js";
import type { EventConfig } from "../shared/config.js";

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

    const raw = await this.env.CONFIG_KV.get(`${EVENT_CONFIG_PREFIX}${eventId}`);
    if (!raw) return null;

    try {
      this.config = JSON.parse(raw) as EventConfig;
      return this.config;
    } catch {
      console.error(`[QueueDO] Failed to parse config for event ${eventId}`);
      return null;
    }
  }

  private async loadSigningKey(eventId: string): Promise<string | null> {
    if (this.signingKey) return this.signingKey;

    const key = await this.env.CONFIG_KV.get(`${SIGNING_KEY_PREFIX}${eventId}`);
    if (key) {
      this.signingKey = key;
    }
    return this.signingKey;
  }

  // ── HTTP handler (stats, config reload) ──

  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized();

    const url = new URL(request.url);

    // Persist the event ID from the query string so the DO knows which event it serves.
    // This is set by the queue-page handler when forwarding requests to the DO.
    const eventIdParam = url.searchParams.get("event");
    if (eventIdParam && !this.config) {
      await this.setEventId(eventIdParam);
      await this.loadConfig(eventIdParam);
    }

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request);
    }

    // Stats endpoint (called by admin Worker)
    if (url.pathname === "/stats") {
      return this.handleStats();
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
        await this.handleJoin(ws, msg.visitorId);
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

  private async handleJoin(ws: WebSocket, existingVisitorId?: string): Promise<void> {
    // Get event ID from the first tag or a stored value
    const eventId = this.getEventId();
    if (!eventId) {
      this.sendToSocket(ws, { type: "error", code: "EVENT_NOT_FOUND", message: "No event configured" });
      return;
    }

    const config = await this.loadConfig(eventId);
    if (!config || !config.enabled) {
      this.sendToSocket(ws, { type: "error", code: "EVENT_INACTIVE", message: "Event is not active" });
      return;
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
        this.ctx.setWebSocketAutoResponse(ws as unknown as Parameters<typeof this.ctx.setWebSocketAutoResponse>[0]);
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
      const released = this.ctx.storage.sql.exec(
        "SELECT token FROM visitors WHERE visitor_id = ? AND released_at IS NOT NULL",
        existingVisitorId,
      ).toArray() as { token: string | null }[];

      if (released.length > 0 && released[0]?.token) {
        this.sendToSocket(ws, { type: "released", token: released[0].token });
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

    // Send initial position
    const queuePos = this.getQueuePosition(position);
    this.sendToSocket(ws, {
      type: "position",
      visitorId,
      position: queuePos.relativePosition,
      totalAhead: queuePos.totalAhead,
      estimatedWaitSeconds: this.estimateWaitSeconds(queuePos.totalAhead),
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

    const config = await this.loadConfig(eventId);
    if (!config || !config.enabled) return;

    // Clean up disconnected visitors past grace period
    this.cleanupDisconnected();

    const releaseRate = config.releaseRate;
    if (releaseRate <= 0) {
      // Queue is paused — broadcast paused state and reschedule
      this.broadcastToAll({ type: "paused", message: "Queue is temporarily paused" });
      await this.ensureAlarmScheduled();
      return;
    }

    // Calculate batch size: releaseRate is per minute, alarm fires every second
    const batchSize = Math.max(1, Math.ceil(releaseRate / 60));

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

    // Reschedule if there are still visitors waiting
    const remaining = this.getActiveVisitorCount();
    if (remaining > 0) {
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

    // Send token via WebSocket
    const ws = this.findSocketForVisitor(visitor.visitor_id);
    if (ws) {
      this.sendToSocket(ws, { type: "released", token });
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
    for (const ws of sockets) {
      const visitorId = this.getVisitorIdFromSocket(ws);
      if (!visitorId) continue;

      const visitor = this.ctx.storage.sql.exec(
        "SELECT position FROM visitors WHERE visitor_id = ? AND released_at IS NULL",
        visitorId,
      ).toArray() as { position: number }[];

      if (visitor.length === 0) continue;

      const pos = this.getQueuePosition(visitor[0]!.position);
      this.sendToSocket(ws, {
        type: "position",
        visitorId,
        position: pos.relativePosition,
        totalAhead: pos.totalAhead,
        estimatedWaitSeconds: this.estimateWaitSeconds(pos.totalAhead),
      });
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
