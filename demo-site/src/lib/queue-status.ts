// ============================================================
// Fetch queue status from the Admin API (public endpoint)
//
// Maps backend eventId → enabled boolean so the demo-site
// can show "Queue Active" badges dynamically instead of
// relying on hardcoded data.
// ============================================================

const ADMIN_API_URL =
  process.env.NEXT_PUBLIC_ADMIN_API_URL ?? process.env.ADMIN_API_URL ?? "";

export type QueueStatusMap = Record<string, boolean>;

/**
 * Fetch queue-enabled status for all configured events (server-side).
 * Returns a map of `{ [eventSlug]: enabled }`.
 *
 * Cached with Next.js `fetch` revalidation (60 s by default).
 * Falls back to an empty map on error so the page still renders.
 */
export async function fetchQueueStatusMap(
  revalidate = 60,
): Promise<QueueStatusMap> {
  if (!ADMIN_API_URL) {
    return {};
  }

  try {
    const res = await fetch(`${ADMIN_API_URL}/api/public/queue-status`, {
      next: { revalidate },
    });

    if (!res.ok) {
      console.error(`[queue-status] API responded ${res.status}`);
      return {};
    }

    const data = (await res.json()) as {
      statuses: { eventId: string; enabled: boolean }[];
    };

    const map: QueueStatusMap = {};
    for (const s of data.statuses) {
      map[s.eventId] = s.enabled;
    }
    return map;
  } catch (e) {
    console.error("[queue-status] Failed to fetch:", e);
    return {};
  }
}

/**
 * Fetch queue-enabled status for a single event (client-side).
 * Falls back to `false` on error.
 */
export async function fetchQueueEnabledForEvent(
  eventSlug: string,
): Promise<boolean> {
  const apiUrl =
    process.env.NEXT_PUBLIC_ADMIN_API_URL ?? "";

  if (!apiUrl) {
    return false;
  }

  try {
    const res = await fetch(`${apiUrl}/api/public/queue-status`);
    if (!res.ok) return false;

    const data = (await res.json()) as {
      statuses: { eventId: string; enabled: boolean }[];
    };
    const match = data.statuses.find((s) => s.eventId === eventSlug);
    return match?.enabled ?? false;
  } catch {
    return false;
  }
}

/**
 * Check if a specific event has queue enabled.
 * Returns `false` if the event is not found in the backend config.
 */
export function isQueueEnabled(
  map: QueueStatusMap,
  eventSlug: string,
): boolean {
  return map[eventSlug] ?? false;
}
