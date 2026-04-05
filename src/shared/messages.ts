// ============================================================
// WebSocket message types between queue page client and DO
//
// Message flow:
//   Client ──▶ DO:
//     { type: "join", visitorId?, turnstileToken? }
//     { type: "ping" }
//
//   DO ──▶ Client:
//     { type: "position", position, totalAhead, estimatedWaitSeconds, pollToken? }
//     { type: "released", token }
//     { type: "pong" }
//     { type: "error", code, message }
//     { type: "paused" }
//     { type: "queue_full" }
//
// The initial "position" message includes a pollToken (HMAC-based)
// that the client can use for HTTP polling fallback via
// GET /queue/poll?event=...&visitor_id=...&poll_token=...
// ============================================================

// ── Client → Server messages ──

export interface JoinMessage {
  type: "join";
  /** Existing visitor ID for reconnection (from cookie/localStorage) */
  visitorId?: string;
  /** Cloudflare Turnstile token (if required by event config) */
  turnstileToken?: string;
}

export interface PingMessage {
  type: "ping";
}

export type ClientMessage = JoinMessage | PingMessage;

// ── Server → Client messages ──

export interface PositionMessage {
  type: "position";
  /** Visitor's unique ID (assigned by DO on first join) */
  visitorId: string;
  /** Current position in queue (1-based, 1 = next to be released) */
  position: number;
  /** Total visitors ahead in queue */
  totalAhead: number;
  /** Estimated wait time in seconds (based on release rate) */
  estimatedWaitSeconds: number;
  /** HMAC poll token for HTTP polling authentication (sent on first position update) */
  pollToken?: string;
}

export interface ReleasedMessage {
  type: "released";
  /** Signed JWT token for accessing the protected resource */
  token: string;
  /** Cookie max-age in seconds (tokenTtlSeconds + grace period) */
  maxAge?: number;
}

export interface PongMessage {
  type: "pong";
}

export interface ErrorMessage {
  type: "error";
  /** Error code (matches WS_CLOSE_CODES or error class codes) */
  code: string;
  /** Human-readable error message */
  message: string;
}

export interface PausedMessage {
  type: "paused";
  /** Optional message to display to the visitor */
  message?: string;
}

export interface QueueFullMessage {
  type: "queue_full";
  /** Current queue size */
  currentSize: number;
  /** Maximum queue size */
  maxSize: number;
}

export type ServerMessage =
  | PositionMessage
  | ReleasedMessage
  | PongMessage
  | ErrorMessage
  | PausedMessage
  | QueueFullMessage;

// ── Helpers ──

/** Type-safe parse of a client WebSocket message */
export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const data = JSON.parse(raw);
    if (typeof data !== "object" || data === null || typeof data.type !== "string") {
      return null;
    }
    if (data.type === "join" || data.type === "ping") {
      return data as ClientMessage;
    }
    return null;
  } catch {
    return null;
  }
}

/** Serialize a server message to JSON string */
export function serializeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}
