// ============================================================
// Constants shared across both Workers
// ============================================================

/** Cookie name for the queue access token */
export const TOKEN_COOKIE_NAME = "__queue_token";

/** KV key prefix for event configs */
export const EVENT_CONFIG_PREFIX = "event:";

/** KV key prefix for signing keys */
export const SIGNING_KEY_PREFIX = "signing_key:";

/** Default token TTL in seconds (30 minutes) */
export const DEFAULT_TOKEN_TTL_SECONDS = 30 * 60;

/** Grace period for expired tokens in seconds (5 minutes) */
export const TOKEN_GRACE_PERIOD_SECONDS = 5 * 60;

/** Default release rate (visitors per minute) */
export const DEFAULT_RELEASE_RATE = 60;

/** Alarm interval in milliseconds (1 second) */
export const ALARM_INTERVAL_MS = 1_000;

/** WebSocket close codes */
export const WS_CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  UNSUPPORTED_DATA: 1003,
  QUEUE_FULL: 4000,
  EVENT_NOT_FOUND: 4001,
  EVENT_INACTIVE: 4002,
  INVALID_MESSAGE: 4003,
} as const;

/** Maximum visitors per Durable Object before rejecting */
export const MAX_VISITORS_PER_DO = 50_000;

/** Visitor position grace period after disconnect (seconds) */
export const DISCONNECT_GRACE_SECONDS = 120;
