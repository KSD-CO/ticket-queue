// ============================================================
// Event configuration types
//
// Stored in KV as JSON under key "event:{eventId}"
//
// Config lifecycle:
//   Admin creates event → stored in KV
//   Gateway reads config → decides whether to queue visitors
//   DO reads config → controls release rate, token TTL
//   Admin updates config → changes propagate via KV (eventual)
// ============================================================

/** How the queue behaves when the queue system itself fails */
export type FailMode = "open" | "closed";

/** Queue activation mode */
export type QueueMode =
  | "always"          // Queue is always active for this event
  | "threshold";      // Queue activates when traffic exceeds threshold

export interface EventConfig {
  /** Unique event identifier (URL-safe string) */
  eventId: string;

  /** Human-readable event name */
  name: string;

  /** Whether the queue is enabled */
  enabled: boolean;

  /** URL pattern(s) to protect (e.g., "/tickets/*", "/checkout") */
  protectedPaths: string[];

  /** Origin server URL to proxy to after token verification */
  originUrl: string;

  /** Release rate: visitors per minute allowed through */
  releaseRate: number;

  /** Queue activation mode */
  mode: QueueMode;

  /** Traffic threshold (visitors/min) to activate queue in "threshold" mode */
  activationThreshold?: number;

  /** Token time-to-live in seconds */
  tokenTtlSeconds: number;

  /** What to do when queue system fails: "open" (let through) or "closed" (block) */
  failMode: FailMode;

  /** Whether Cloudflare Turnstile is required before entering queue */
  turnstileEnabled: boolean;

  /** Turnstile site key (if enabled) */
  turnstileSiteKey?: string;

  /** Turnstile secret key (if enabled) */
  turnstileSecretKey?: string;

  /** Maximum visitors allowed in queue (0 = unlimited up to DO limit) */
  maxQueueSize: number;

  /** ISO 8601 timestamp when event starts (optional, for display) */
  eventStartTime?: string;

  /** ISO 8601 timestamp when event ends (optional, queue deactivates) */
  eventEndTime?: string;

  /** Created timestamp */
  createdAt: string;

  /** Last updated timestamp */
  updatedAt: string;
}

/** Defaults for creating a new event */
export const DEFAULT_EVENT_CONFIG: Omit<EventConfig, "eventId" | "name" | "protectedPaths" | "originUrl" | "createdAt" | "updatedAt"> = {
  enabled: true,
  releaseRate: 60,
  mode: "always",
  tokenTtlSeconds: 30 * 60, // 30 minutes
  failMode: "open",
  turnstileEnabled: false,
  maxQueueSize: 0,
};

/** Fields required when creating a new event */
export interface CreateEventInput {
  eventId: string;
  name: string;
  protectedPaths: string[];
  originUrl: string;
  releaseRate?: number;
  mode?: QueueMode;
  activationThreshold?: number;
  tokenTtlSeconds?: number;
  failMode?: FailMode;
  turnstileEnabled?: boolean;
  turnstileSiteKey?: string;
  turnstileSecretKey?: string;
  maxQueueSize?: number;
  eventStartTime?: string;
  eventEndTime?: string;
}

/** Fields allowed when updating an event */
export type UpdateEventInput = Partial<Omit<CreateEventInput, "eventId">>;

/** Validate a CreateEventInput, returning error messages per field */
export function validateCreateEvent(input: unknown): { valid: true; data: CreateEventInput } | { valid: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  if (!input || typeof input !== "object") {
    return { valid: false, errors: { _root: "Request body must be a JSON object" } };
  }

  const data = input as Record<string, unknown>;

  if (typeof data.eventId !== "string" || data.eventId.length === 0) {
    errors.eventId = "eventId is required and must be a non-empty string";
  } else if (!/^[a-zA-Z0-9_-]+$/.test(data.eventId)) {
    errors.eventId = "eventId must be URL-safe (alphanumeric, hyphens, underscores)";
  }

  if (typeof data.name !== "string" || data.name.length === 0) {
    errors.name = "name is required and must be a non-empty string";
  }

  if (!Array.isArray(data.protectedPaths) || data.protectedPaths.length === 0) {
    errors.protectedPaths = "protectedPaths is required and must be a non-empty array of strings";
  } else if (data.protectedPaths.some((p: unknown) => typeof p !== "string")) {
    errors.protectedPaths = "All protectedPaths must be strings";
  }

  if (typeof data.originUrl !== "string" || data.originUrl.length === 0) {
    errors.originUrl = "originUrl is required and must be a non-empty string";
  } else {
    try {
      const url = new URL(data.originUrl);
      if (url.protocol !== "https:") {
        errors.originUrl = "originUrl must use HTTPS";
      }
    } catch {
      errors.originUrl = "originUrl must be a valid URL";
    }
  }

  if (data.releaseRate !== undefined) {
    if (typeof data.releaseRate !== "number" || data.releaseRate < 0) {
      errors.releaseRate = "releaseRate must be a non-negative number";
    }
  }

  if (data.tokenTtlSeconds !== undefined) {
    if (typeof data.tokenTtlSeconds !== "number" || data.tokenTtlSeconds < 60) {
      errors.tokenTtlSeconds = "tokenTtlSeconds must be at least 60";
    }
  }

  if (data.failMode !== undefined && data.failMode !== "open" && data.failMode !== "closed") {
    errors.failMode = 'failMode must be "open" or "closed"';
  }

  if (data.mode !== undefined && data.mode !== "always" && data.mode !== "threshold") {
    errors.mode = 'mode must be "always" or "threshold"';
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: data as unknown as CreateEventInput };
}
