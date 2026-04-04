// ============================================================
// Constants shared across both Workers
// ============================================================

/** Cookie name for the queue access token */
export const TOKEN_COOKIE_NAME = "__queue_token";

/** KV key prefix for event configs */
export const EVENT_CONFIG_PREFIX = "event:";

/** KV key prefix for signing keys */
export const SIGNING_KEY_PREFIX = "signing_key:";

/** KV key for path→eventId lookup index (avoids KV.list) */
export const PATH_INDEX_KEY = "_index:path_map";

/** KV key for event ID list index (avoids KV.list) */
export const EVENT_IDS_INDEX_KEY = "_index:event_ids";

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
