// ============================================================
// Admin API handlers — CRUD events, adjust rate, get stats
// ============================================================

import type { Context } from "hono";
import {
  validateCreateEvent,
  DEFAULT_EVENT_CONFIG,
  type EventConfig,
  type UpdateEventInput,
} from "../shared/config.js";
import {
  EVENT_CONFIG_PREFIX,
  SIGNING_KEY_PREFIX,
  PATH_INDEX_KEY,
  EVENT_IDS_INDEX_KEY,
} from "../shared/constants.js";
import {
  EventNotFoundError,
  ValidationError,
} from "../shared/errors.js";

interface AdminEnv {
  CONFIG_KV: KVNamespace;
  QUEUE_DO: DurableObjectNamespace;
  ADMIN_API_KEY: string;
}

type AdminContext = Context<{ Bindings: AdminEnv }>;

// ── Index types ──

/** path_map: { "/checkout": "event-id", "/checkout/*": "event-id" } */
type PathMap = Record<string, string>;

/** event_ids: ["event-id-1", "event-id-2"] */
type EventIdList = string[];

/** Read the path index from KV (or empty object if missing) */
async function getPathIndex(kv: KVNamespace): Promise<PathMap> {
  const raw = await kv.get(PATH_INDEX_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) as PathMap; } catch { return {}; }
}

/** Read the event IDs index from KV (or empty array if missing) */
async function getEventIdsIndex(kv: KVNamespace): Promise<EventIdList> {
  const raw = await kv.get(EVENT_IDS_INDEX_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as EventIdList; } catch { return []; }
}

/**
 * Rebuild both indexes from scratch by reading all event configs.
 * Uses event_ids index to enumerate events (KV.get, not KV.list),
 * then rebuilds path_map from all configs' protectedPaths.
 */
async function rebuildIndexes(kv: KVNamespace, action: "upsert" | "delete", eventId: string, config?: EventConfig): Promise<void> {
  // Step 1: Update the event IDs list
  const eventIds = await getEventIdsIndex(kv);
  const filteredIds = eventIds.filter((id) => id !== eventId);
  if (action === "upsert") {
    filteredIds.push(eventId);
  }

  // Step 2: Rebuild path_map from all active event configs
  const pathMap: PathMap = {};
  const configs = await Promise.all(
    filteredIds.map((id) => kv.get(`${EVENT_CONFIG_PREFIX}${id}`)),
  );

  for (const raw of configs) {
    if (!raw) continue;
    try {
      const c = JSON.parse(raw) as EventConfig;
      for (const p of c.protectedPaths) {
        // First event to claim a path wins (no overwrite)
        if (!pathMap[p]) {
          pathMap[p] = c.eventId;
        }
      }
    } catch { /* skip malformed */ }
  }

  await Promise.all([
    kv.put(PATH_INDEX_KEY, JSON.stringify(pathMap)),
    kv.put(EVENT_IDS_INDEX_KEY, JSON.stringify(filteredIds)),
  ]);
}

/**
 * Best-effort notification to the Durable Object to reload config.
 * Uses waitUntil so the response isn't delayed. Silently catches errors
 * since the DO will lazily load config from KV on the next visitor anyway.
 */
function notifyDO(c: AdminContext, eventId: string): void {
  try {
    const doId = c.env.QUEUE_DO.idFromName(eventId);
    const doStub = c.env.QUEUE_DO.get(doId);
    const promise = doStub
      .fetch(new Request("https://internal/reload-config?eventId=" + eventId))
      .catch((e: unknown) => console.error("[Admin] DO notification failed:", e));
    c.executionCtx.waitUntil(promise);
  } catch {
    // executionCtx or QUEUE_DO may not be available (e.g., in tests)
  }
}

/** POST /api/events — create a new event */
export async function createEvent(c: AdminContext): Promise<Response> {
  const body = await c.req.json().catch(() => null);
  const validation = validateCreateEvent(body);

  if (!validation.valid) {
    throw new ValidationError("Invalid event configuration", validation.errors);
  }

  const input = validation.data;
  const existingRaw = await c.env.CONFIG_KV.get(`${EVENT_CONFIG_PREFIX}${input.eventId}`);
  if (existingRaw) {
    throw new ValidationError("Event already exists", { eventId: `Event '${input.eventId}' already exists` });
  }

  const now = new Date().toISOString();
  const config: EventConfig = {
    ...DEFAULT_EVENT_CONFIG,
    ...input,
    createdAt: now,
    updatedAt: now,
  };

  // Generate a signing key for this event
  const signingKey = crypto.randomUUID() + crypto.randomUUID();

  // Store config and signing key
  await Promise.all([
    c.env.CONFIG_KV.put(`${EVENT_CONFIG_PREFIX}${input.eventId}`, JSON.stringify(config)),
    c.env.CONFIG_KV.put(`${SIGNING_KEY_PREFIX}${input.eventId}`, signingKey),
  ]);

  // Update indexes (path_map + event_ids)
  await rebuildIndexes(c.env.CONFIG_KV, "upsert", input.eventId, config);

  // Notify the Durable Object to reload config (best-effort, non-blocking).
  notifyDO(c, input.eventId);

  console.log(`[Admin] Created event: ${input.eventId}`);
  return c.json(config, 201);
}

/** GET /api/events — list all events */
export async function listEvents(c: AdminContext): Promise<Response> {
  const eventIds = await getEventIdsIndex(c.env.CONFIG_KV);
  const events: EventConfig[] = [];

  // Fetch all configs in parallel using KV.get (not KV.list)
  const results = await Promise.all(
    eventIds.map((id) => c.env.CONFIG_KV.get(`${EVENT_CONFIG_PREFIX}${id}`)),
  );

  for (const raw of results) {
    if (raw) {
      try {
        events.push(JSON.parse(raw) as EventConfig);
      } catch {
        // Skip malformed entries
      }
    }
  }

  return c.json({ events, total: events.length });
}

/** GET /api/events/:id — get single event */
export async function getEvent(c: AdminContext): Promise<Response> {
  const eventId = c.req.param("id")!;
  const raw = await c.env.CONFIG_KV.get(`${EVENT_CONFIG_PREFIX}${eventId}`);

  if (!raw) {
    throw new EventNotFoundError(eventId);
  }

  return c.json(JSON.parse(raw));
}

/** PUT /api/events/:id — update event */
export async function updateEvent(c: AdminContext): Promise<Response> {
  const eventId = c.req.param("id")!;
  const raw = await c.env.CONFIG_KV.get(`${EVENT_CONFIG_PREFIX}${eventId}`);

  if (!raw) {
    throw new EventNotFoundError(eventId);
  }

  const existing = JSON.parse(raw) as EventConfig;
  const updates = (await c.req.json()) as UpdateEventInput;

  // Merge updates
  const updated: EventConfig = {
    ...existing,
    ...updates,
    eventId: existing.eventId, // Cannot change event ID
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  await c.env.CONFIG_KV.put(`${EVENT_CONFIG_PREFIX}${eventId}`, JSON.stringify(updated));

  // Update indexes (protectedPaths may have changed)
  await rebuildIndexes(c.env.CONFIG_KV, "upsert", eventId, updated);

  // Notify DO to reload config (best-effort)
  notifyDO(c, eventId);

  console.log(`[Admin] Updated event: ${eventId}`);
  return c.json(updated);
}

/** DELETE /api/events/:id — delete event */
export async function deleteEvent(c: AdminContext): Promise<Response> {
  const eventId = c.req.param("id")!;
  const raw = await c.env.CONFIG_KV.get(`${EVENT_CONFIG_PREFIX}${eventId}`);

  if (!raw) {
    throw new EventNotFoundError(eventId);
  }

  await Promise.all([
    c.env.CONFIG_KV.delete(`${EVENT_CONFIG_PREFIX}${eventId}`),
    c.env.CONFIG_KV.delete(`${SIGNING_KEY_PREFIX}${eventId}`),
  ]);

  // Update indexes
  await rebuildIndexes(c.env.CONFIG_KV, "delete", eventId);

  console.log(`[Admin] Deleted event: ${eventId}`);
  return c.json({ deleted: true, eventId });
}

/** PUT /api/events/:id/rate — adjust release rate */
export async function updateRate(c: AdminContext): Promise<Response> {
  const eventId = c.req.param("id")!;
  const raw = await c.env.CONFIG_KV.get(`${EVENT_CONFIG_PREFIX}${eventId}`);

  if (!raw) {
    throw new EventNotFoundError(eventId);
  }

  const { releaseRate } = (await c.req.json()) as { releaseRate: number };
  if (typeof releaseRate !== "number" || releaseRate < 0) {
    throw new ValidationError("releaseRate must be a non-negative number");
  }

  const config = JSON.parse(raw) as EventConfig;
  config.releaseRate = releaseRate;
  config.updatedAt = new Date().toISOString();

  await c.env.CONFIG_KV.put(`${EVENT_CONFIG_PREFIX}${eventId}`, JSON.stringify(config));

  // Notify DO to reload config (best-effort)
  notifyDO(c, eventId);

  console.log(`[Admin] Updated release rate for ${eventId}: ${releaseRate}/min`);
  return c.json({ eventId, releaseRate });
}

/** GET /api/public/queue-status — public endpoint, returns {eventId, enabled} for all events */
export async function getPublicQueueStatus(c: AdminContext): Promise<Response> {
  const eventIds = await getEventIdsIndex(c.env.CONFIG_KV);
  const statuses: { eventId: string; enabled: boolean }[] = [];

  // Fetch all configs in parallel using KV.get (not KV.list)
  const results = await Promise.all(
    eventIds.map((id) => c.env.CONFIG_KV.get(`${EVENT_CONFIG_PREFIX}${id}`)),
  );

  for (const raw of results) {
    if (raw) {
      try {
        const config = JSON.parse(raw) as EventConfig;
        statuses.push({ eventId: config.eventId, enabled: config.enabled });
      } catch {
        // Skip malformed entries
      }
    }
  }

  return c.json({ statuses });
}

/** GET /api/events/:id/stats — get queue stats from DO */
export async function getStats(c: AdminContext): Promise<Response> {
  const eventId = c.req.param("id")!;

  const doId = c.env.QUEUE_DO.idFromName(eventId);
  const doStub = c.env.QUEUE_DO.get(doId);

  const response = await doStub.fetch(new Request("https://internal/stats"));
  const stats = (await response.json()) as Record<string, unknown>;

  return c.json({ eventId, ...stats });
}
