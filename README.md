# VIBE — Virtual Queue Ticket System

A **Cloudflare Workers-based virtual waiting room** that protects ticket-selling websites from traffic spikes during onsales. Visitors are held in a fair FIFO queue and released at a controlled rate, preventing origin servers from being overwhelmed.

Includes a **full Next.js demo site** — a fictional Vietnamese music event ticketing platform called **VIBE** — to demonstrate the queue in action.

---

## System Architecture

```
                                  ┌─────────────────────────────────────────────────────────┐
                                  │                   CLOUDFLARE EDGE                       │
                                  │                                                         │
  ┌─────────┐    HTTPS            │  ┌───────────────────────────────────────────────────┐  │
  │ Browser │─────────────────────┼─▶│           Worker 1: ticket-queue-worker           │  │
  │         │◀────────────────────┼──│  (Hono)   ticket.ironcode.cloud/*                 │  │
  └─────────┘                     │  │                                                   │  │
       │                          │  │  ┌─────────────┐  ┌──────────┐  ┌─────────────┐  │  │
       │ WSS                      │  │  │   Gateway    │  │  Queue   │  │  Queue WS   │  │  │
       │                          │  │  │   /* (all)   │  │  Page    │  │  /queue/ws   │  │  │
       │                          │  │  │              │  │  /queue  │  │             ─┼──┼──┼─┐
       │                          │  │  └──────┬───────┘  └──────────┘  └─────────────┘  │  │ │
       │                          │  └─────────┼─────────────────────────────────────────┘  │ │
       │                          │            │                                            │ │
       │                          │            │ read                                       │ │
       │                          │            ▼                                            │ │
       │                          │  ┌─────────────────┐                                   │ │
       │                          │  │   CONFIG_KV     │◀──── write ────┐                  │ │
       │                          │  │  (KV Namespace)  │                │                  │ │
       │                          │  │                 │                │                  │ │
       │                          │  │  event:{id}     │    ┌──────────┴──────────────┐   │ │
       │                          │  │  signing_key:{} │    │  Worker 2: queue-admin  │   │ │
       │                          │  └─────────────────┘    │  (Hono)                │   │ │
       │                          │            ▲             │                        │   │ │
       │                          │            │ read        │  /api/events    CRUD   │   │ │
       │                          │            │             │  /api/events/:id/rate  │   │ │
       │                          │  ┌─────────┴──────────┐  │  /api/events/:id/stats │   │ │
       │                          │  │  QueueDurableObject │◀─│  /api/public/queue-   │   │ │
       │      WebSocket ◀─────────┼──│  (1 per event)     │  │       status           │   │ │
       │                          │  │                    │  └─────────────────────────┘   │ │
       │                          │  │  SQLite:           │         ▲                      │ │
       │                          │  │    visitors table  │         │ Bearer auth           │ │
       │                          │  │    _meta table     │    ┌────┴─────┐                │ │
       │                          │  │                    │    │  Admin   │                │ │
       │                          │  │  Alarm (1s):       │    │Dashboard │                │ │
       │                          │  │    release visitors│    │ /admin   │                │ │
       │                          │  │    sign JWT tokens │    └──────────┘                │ │
       │                          │  └────────────────────┘                                │ │
       │                          │                                                         │ │
       │                          └─────────────────────────────────────────────────────────┘ │
       │                                         │                                           │
       │                                         │ proxy (valid token)                       │
       │                                         ▼                                           │
       │                               ┌──────────────────┐                                  │
       │                               │  Origin Server   │                                  │
       │                               │  (your site)     │                                  │
       │                               └──────────────────┘                                  │
       │                                                                                     │
       └─────────────────────────────────────────────────────────────────────────────────────┘
```

### Component Overview

| Component | Tech | Role |
|---|---|---|
| **Worker 1** `ticket-queue-worker` | Cloudflare Workers + Hono | Gateway (token verify + proxy), queue page, WebSocket to DO |
| **Worker 2** `ticket-queue-admin` | Cloudflare Workers + Hono | REST API for event CRUD, rate control, queue stats, public status |
| **QueueDurableObject** | Durable Objects + SQLite + WS Hibernation | One instance per event. FIFO queue, alarm-based release, JWT signing |
| **CONFIG_KV** | Cloudflare KV | Shared config store: event configs + signing keys |
| **Demo Site** | Next.js 16 + React 19 + Tailwind CSS v4 | Music event ticketing site with queue integration |

---

## Visitor Workflow

### Full request lifecycle from ticket purchase to checkout

```
 Visitor                   Gateway (Worker 1)              Queue Page              DO (per event)                   Origin
   │                            │                             │                        │                              │
   │  1. GET /checkout          │                             │                        │                              │
   ├───────────────────────────▶│                             │                        │                              │
   │                            │  2. Cookie __queue_token?   │                        │                              │
   │                            │     NO                      │                        │                              │
   │                            │  3. findEventForPath()      │                        │                              │
   │                            │     KV lookup: event:*      │                        │                              │
   │                            │     Path matches            │                        │                              │
   │                            │     protectedPaths          │                        │                              │
   │  4. 302 Redirect           │                             │                        │                              │
   │◀──/queue?event=X&return──  │                             │                        │                              │
   │     _url=/checkout         │                             │                        │                              │
   │                            │                             │                        │                              │
   │  5. GET /queue?event=X     │                             │                        │                              │
   ├───────────────────────────▶│ ───────────────────────────▶│                        │                              │
   │                            │                             │  6. Serve queue.html   │                              │
   │  HTML + JS + CSS           │                             │     (inject event ID)  │                              │
   │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│ ◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                        │                              │
   │                            │                             │                        │                              │
   │  7. WSS /queue/ws?event=X  │                             │                        │                              │
   ├───────────────────────────▶│ ──────────────────────────────────────────────────────▶│                              │
   │                            │         DO.fetch()          │         8. Accept WS    │                              │
   │                            │         (WS upgrade)        │            Load config  │                              │
   │  ◀── WebSocket Open ──────────────────────────────────────────────────────────────│                              │
   │                            │                             │                        │                              │
   │  9. { type: "join" }       │                             │                        │                              │
   ├──────────────────────────────────────────────────────────────────────────────────▶│                              │
   │                            │                             │         10. Validate    │                              │
   │                            │                             │             config      │                              │
   │                            │                             │             enabled?    │                              │
   │                            │                             │         11. INSERT      │                              │
   │                            │                             │             visitor     │                              │
   │                            │                             │             (SQLite)    │                              │
   │                            │                             │         12. Schedule    │                              │
   │                            │                             │             alarm       │                              │
   │  13. { type: "position",   │                             │                        │                              │
   │        position: 42,       │                             │                        │                              │
   │        totalAhead: 41 }    │                             │                        │                              │
   │◀──────────────────────────────────────────────────────────────────────────────────│                              │
   │                            │                             │                        │                              │
   │         ... visitor waits, receives position updates every ~1s ...                │                              │
   │                            │                             │                        │                              │
   │                            │                             │  ┌──── Alarm (1s) ────┐│                              │
   │                            │                             │  │ 14. Batch release:  ││                              │
   │                            │                             │  │   ceil(rate/60)     ││                              │
   │                            │                             │  │   visitors/tick     ││                              │
   │                            │                             │  │ 15. Sign JWT per    ││                              │
   │                            │                             │  │   visitor (HMAC-    ││                              │
   │                            │                             │  │   SHA256)           ││                              │
   │                            │                             │  └─────────────────────┘│                              │
   │                            │                             │                        │                              │
   │  16. { type: "released",   │                             │                        │                              │
   │        token: "eyJ..." }   │                             │                        │                              │
   │◀──────────────────────────────────────────────────────────────────────────────────│                              │
   │                            │                             │                        │                              │
   │  17. Set cookie:           │                             │                        │                              │
   │      __queue_token=eyJ...  │                             │                        │                              │
   │                            │                             │                        │                              │
   │  18. GET /checkout         │                             │                        │                              │
   │      (with cookie)         │                             │                        │                              │
   ├───────────────────────────▶│                             │                        │                              │
   │                            │  19. Verify token:          │                        │                              │
   │                            │      HMAC-SHA256            │                        │                              │
   │                            │      check evt claim        │                        │                              │
   │                            │      check exp + grace      │                        │                              │
   │                            │                             │                        │                              │
   │                            │  20. Proxy to origin ───────────────────────────────────────────────────────────────▶│
   │                            │                             │                        │                              │
   │  21. Checkout page         │                             │                        │                              │
   │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│ ◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
   │                            │                             │                        │                              │
```

---

## Gateway Decision Tree

```
                         ┌──────────────────┐
                         │  Incoming Request │
                         │  (any path)       │
                         └────────┬─────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │  Has __queue_token cookie?  │
                    └──────┬──────────────┬──────┘
                           │              │
                          YES             NO
                           │              │
                ┌──────────▼──────────┐  ┌▼─────────────────────┐
                │ findEventForPath()  │  │  findEventForPath()  │
                │ (KV lookup)         │  │  (KV lookup)         │
                └──────┬────────┬─────┘  └──────┬──────────┬────┘
                       │        │               │          │
                    matched   no match       matched    no match
                       │        │               │          │
            ┌──────────▼───┐    │    ┌──────────▼───────┐  │
            │ checkSchedule│    │    │  checkSchedule()  │  │
            │ + get signing│    │    └──┬──────┬──────┬──┘  │
            │ key from KV  │    │       │      │      │     │
            └──────┬───────┘    │   not_started│   ended    │
                   │            │       │   active    │  ┌──▼──────────┐
            ┌──────▼───────┐    │    ┌──▼──┐   │   ┌──▼──┐│ Passthrough │
            │ verifyToken()│    │    │ 403 │   │   │proxy││ fetch(req)  │
            │ (all keys)   │    │    │     │   │   │edge ││             │
            └──┬───┬───┬───┘    │    └─────┘   │   │cache│└─────────────┘
               │   │   │        │           ┌──▼──────────┐
            valid  │ expired    │           │ 302 Redirect │
            +evt   │ (past      │           │ /queue?event │
            match  │  grace)    │           │ =X&return_   │
               │   │   │        │           │ url=...      │
    ┌──────────▼┐  │  ┌▼──────────────┐    └──────────────┘
    │ Proxy to  │  │  │ 302 → /queue  │
    │ origin    │  │  └───────────────┘
    │ (edge     │  │
    │  cached)  │  │
    └───────────┘  │
                   │
         ┌─────────▼─────────┐
         │ Key missing or    │
         │ KV/DO error       │
         └─────────┬─────────┘
                   │
           ┌───────▼────────┐
           │  failMode?     │
           ├────────┬───────┤
           │ "open" │"closed│
           │ proxy  │ 503 + │
           │ origin │Retry- │
           │        │After  │
           └────────┴───────┘
```

---

## Durable Object State Machine

Each event gets one `QueueDurableObject` instance. The DO manages all visitors for that event using SQLite and WebSocket Hibernation.

```
                              ┌──────┐
                              │ IDLE │ (no visitors)
                              └──┬───┘
                                 │ visitor connects via WS
                                 │ config loaded + enabled
                                 ▼
                            ┌────────┐
                        ┌──▶│ ACTIVE │◀─────────────────┐
                        │   └───┬────┘                   │
                        │       │                        │
                        │       │ visitor sends "join"   │
                        │       ▼                        │
                        │  ┌──────────┐                  │
                        │  │ QUEUEING │                  │
                        │  │          │                  │
                        │  │ assign   │ alarm fires      │
                        │  │ position │ every 1s         │
                        │  │ (FIFO)   │                  │
                        │  │          │                  │
                        │  │          ▼                  │
                        │  │  ┌─────────────────┐       │
                        │  │  │ Release batch:  │       │
                        │  │  │ ceil(rate/60)   │       │
                        │  │  │ visitors/tick   │       │
                        │  │  │                 │       │
                        │  │  │ For each:       │       │
                        │  │  │   Sign JWT      │       │
                        │  │  │   UPDATE SQLite │       │
                        │  │  │   WS → released │       │
                        │  │  └───────┬─────────┘       │
                        │  │          │                  │
                        │  │  broadcast position         │
                        │  │  updates to remaining       │
                        │  └──────────┘                  │
                        │                                │
                        │       last visitor released    │
                        └────────────────────────────────┘
                                 │
                      enabled=false or event ended
                                 │
                                 ▼
                           ┌───────────┐
                           │ DRAINING  │──(all released)──▶ COMPLETE
                           └───────────┘
```

### SQLite Schema (inside each DO instance)

```sql
-- Visitor queue state
CREATE TABLE visitors (
    visitor_id    TEXT PRIMARY KEY,      -- UUID
    position      INTEGER NOT NULL,      -- monotonically increasing
    joined_at     INTEGER NOT NULL,      -- Unix timestamp (ms)
    released_at   INTEGER,               -- NULL if still waiting
    disconnected  INTEGER DEFAULT 0,     -- 1 if WS disconnected (grace period)
    token         TEXT                   -- JWT string after release
);

CREATE INDEX idx_visitors_position
    ON visitors(position) WHERE released_at IS NULL;

-- DO identity (survives hibernation)
CREATE TABLE _meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
-- Stores: ('event_id', 'neon-nights-2026')
```

---

## WebSocket Message Protocol

### Client → Server

```
┌──────────────────────────────────────────────────────────┐
│                    JOIN                                   │
│  { type: "join", visitorId?: string }                    │
│                                                          │
│  Sent on connect. Include visitorId from localStorage    │
│  to reconnect and preserve queue position.               │
├──────────────────────────────────────────────────────────┤
│                    PING                                   │
│  { type: "ping" }                                        │
│                                                          │
│  Heartbeat sent every 30s to keep connection alive.      │
└──────────────────────────────────────────────────────────┘
```

### Server → Client

```
┌──────────────────────────────────────────────────────────┐
│                  POSITION                                 │
│  {                                                       │
│    type: "position",                                     │
│    visitorId: "uuid",        // store in localStorage    │
│    position: 42,             // 1-based queue position   │
│    totalAhead: 41,           // people ahead             │
│    estimatedWaitSeconds: 120,// -1 if paused             │
│    pollToken: "a3f8c2..."   // HMAC token for HTTP poll  │
│  }                                                       │
│  Sent on join and after each alarm release cycle.        │
├──────────────────────────────────────────────────────────┤
│                  RELEASED                                 │
│  { type: "released", token: "eyJhbGci..." }              │
│                                                          │
│  Visitor released! Set cookie and redirect.              │
├──────────────────────────────────────────────────────────┤
│                  PAUSED                                   │
│  { type: "paused", message?: "Queue paused" }            │
│                                                          │
│  releaseRate set to 0 by admin. No one is released.      │
├──────────────────────────────────────────────────────────┤
│                  QUEUE_FULL                               │
│  { type: "queue_full", currentSize: 50000, maxSize: ... }│
│                                                          │
│  Queue at capacity. Visitor cannot join.                 │
├──────────────────────────────────────────────────────────┤
│                  ERROR                                    │
│  { type: "error", code: "...", message: "..." }          │
│                                                          │
│  Codes: EVENT_NOT_FOUND, EVENT_INACTIVE,                 │
│         TEMPORARY_ERROR, INVALID_MESSAGE, STORAGE_FULL   │
├──────────────────────────────────────────────────────────┤
│                  PONG                                     │
│  { type: "pong" }                                        │
│                                                          │
│  Heartbeat acknowledgment.                               │
└──────────────────────────────────────────────────────────┘
```

---

## Admin API Workflow

```
  Admin Dashboard               Worker 2 (queue-admin)           CONFIG_KV              Durable Object
       │                              │                              │                       │
       │  POST /api/events            │                              │                       │
       │  { eventId, name,            │                              │                       │
       │    protectedPaths, ... }     │                              │                       │
       ├─────────────────────────────▶│                              │                       │
       │                              │  1. Validate input           │                       │
       │                              │  2. Check duplicate          │                       │
       │                              │                              │                       │
       │                              │  3. Generate signing key     │                       │
       │                              │     randomUUID() x 2        │                       │
       │                              │                              │                       │
       │                              │  4. KV.put (parallel)        │                       │
       │                              │ ────────────────────────────▶│                       │
       │                              │    event:{id} = config JSON  │                       │
       │                              │    signing_key:{id} = key    │                       │
       │                              │                              │                       │
       │                              │  5. notifyDO (best-effort)   │                       │
       │                              │ ─────────────────────────────┼──────────────────────▶│
       │                              │    /reload-config?eventId=X  │   null config cache   │
       │                              │    (via waitUntil)           │   reload from KV      │
       │                              │                              │                       │
       │  201 { config }              │                              │                       │
       │◀─────────────────────────────│                              │                       │
       │                              │                              │                       │
       │  PUT /api/events/:id/rate    │                              │                       │
       │  { releaseRate: 200 }        │                              │                       │
       ├─────────────────────────────▶│                              │                       │
       │                              │  Update KV                   │                       │
       │                              │ ────────────────────────────▶│                       │
       │                              │  Notify DO                   │                       │
       │                              │ ─────────────────────────────┼──────────────────────▶│
       │                              │                              │   Hot reload config   │
       │                              │                              │   Next alarm uses     │
       │  200 { releaseRate: 200 }    │                              │   new rate            │
       │◀─────────────────────────────│                              │                       │
```

### Admin API Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Health check |
| `GET` | `/api/public/queue-status` | **No** | Public: `{ eventId, enabled }` for all events |
| `POST` | `/api/events` | Bearer | Create event with queue config |
| `GET` | `/api/events` | Bearer | List all events |
| `GET` | `/api/events/:id` | Bearer | Get event by ID |
| `PUT` | `/api/events/:id` | Bearer | Update event config (validated via `validateUpdateEvent`) |
| `DELETE` | `/api/events/:id` | Bearer | Delete event + signing key |
| `PUT` | `/api/events/:id/rate` | Bearer | Adjust release rate (visitors/min) |
| `POST` | `/api/events/:id/rotate-key` | Bearer | Rotate signing key (max 3 keys retained) |
| `GET` | `/api/events/:id/stats` | Bearer | Queue stats (active, released, avg wait, WS connections) |

---

## Storage Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CONFIG_KV (Cloudflare KV)                  │
│                                                                     │
│  Key                              │  Value                          │
│ ──────────────────────────────────┼──────────────────────────────── │
│  event:neon-nights-2026           │  { eventId, name, enabled,      │
│                                   │    protectedPaths, originUrl,   │
│                                   │    releaseRate, mode,           │
│                                   │    eventStartTime, eventEndTime,│
│                                   │    edgeCacheTtl, browserCacheTtl│
│                                   │    turnstileEnabled, failMode,  │
│                                   │    createdAt, updatedAt }       │
│                                   │                                 │
│  signing_key:neon-nights-2026     │  [{ key: "a1b2...", active: true│
│                                   │     createdAt: "2026-..." },    │
│                                   │   { key: "x9y8...", active:     │
│                                   │     false, createdAt: "..." }]  │
│                                   │  (JSON array, max 3 keys)       │
└───────────────────────────────────┴─────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│              Durable Object SQLite (per event instance)             │
│                                                                     │
│  visitors                                                           │
│  ┌──────────────┬──────────┬───────────┬────────────┬──────┬──────┐│
│  │ visitor_id   │ position │ joined_at │released_at │discon│token ││
│  ├──────────────┼──────────┼───────────┼────────────┼──────┼──────┤│
│  │ uuid-001     │ 1        │ 17752...  │ 17752...   │ 0    │eyJ...││
│  │ uuid-002     │ 2        │ 17752...  │ NULL       │ 0    │ NULL ││
│  │ uuid-003     │ 3        │ 17752...  │ NULL       │ 1    │ NULL ││
│  └──────────────┴──────────┴───────────┴────────────┴──────┴──────┘│
│                                                                     │
│  _meta                                                              │
│  ┌────────────┬─────────────────────┐                               │
│  │ key        │ value               │                               │
│  ├────────────┼─────────────────────┤                               │
│  │ event_id   │ neon-nights-2026    │  (survives hibernation)       │
│  └────────────┴─────────────────────┘                               │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     Client-Side Storage                             │
│                                                                     │
│  Cookie:       __queue_token = eyJhbGciOi... (JWT, max-age=3600)   │
│  localStorage: queue_visitor_neon-nights-2026 = uuid-002            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## JWT Token Structure

Tokens are signed using **HMAC-SHA256** via the Web Crypto API (zero library dependencies).

```
Header:  { "alg": "HS256", "typ": "JWT" }
Payload: {
  "sub": "uuid-002",           // visitor ID
  "evt": "neon-nights-2026",   // event ID (verified by gateway)
  "iat": 1775232800,           // issued at (Unix seconds)
  "exp": 1775234600,           // expires at (iat + tokenTtlSeconds)
  "pos": 42                    // queue position when released
}
Signature: HMAC-SHA256(header.payload, signing_key)
```

**Verification** at the gateway includes a **5-minute grace period** after expiry, allowing visitors to complete in-flight purchases even if their token technically expired seconds ago.

---

## Demo Site Integration

The Next.js demo site integrates with the queue system at three levels:

```
┌──────────────────────────────────────────────────────────────────┐
│                     Demo Site (Next.js 16)                       │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Server Components (SSR/SSG)                                │ │
│  │                                                             │ │
│  │  fetchQueueStatusMap() ──GET──▶ /api/public/queue-status    │ │
│  │    ↓ (revalidate: 60s)                                      │ │
│  │  { "neon-nights-2026": true, "acoustic-garden": false }     │ │
│  │    ↓                                                        │ │
│  │  isQueueEnabled(map, event.slug)                            │ │
│  │    ↓                                                        │ │
│  │  <EventCard queueEnabled={true} />  ← "Queue Active" badge │ │
│  │  <TicketSelector queueEnabled={true} /> ← "Join Queue" CTA │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Client Components                                          │ │
│  │                                                             │ │
│  │  /checkout (client-side)                                    │ │
│  │    ↓ fetchQueueEnabledForEvent(slug)                        │ │
│  │    ↓                                                        │ │
│  │  if queueEnabled && !hasToken:                              │ │
│  │    <QueueOverlay />  ← full-screen WebSocket queue UI       │ │
│  │      ↓ WSS /queue/ws?event=X                                │ │
│  │      ↓ position updates, released → set cookie              │ │
│  │      ↓ onRelease → dismiss overlay → show checkout form     │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## Resilience Patterns

### 1. Fail-Open / Fail-Closed Gateway

If the queue system itself has an error, behavior depends on the event's `failMode`:

```
failMode: "open" (default)
  KV unavailable       → proxy to origin anyway
  Signing key missing  → log critical error, proxy to origin
  DO unreachable       → proxy to origin
  Config parse error   → skip event, proxy to origin

failMode: "closed"
  Any system error     → 503 Service Temporarily Unavailable
                         Retry-After: 30
```

### 2. Edge Caching (Origin Protection)

Three layers protect the origin from traffic spikes:

```
Layer 1 — Cache API (caches.default):
  proxyToOrigin() checks cache.match(url) before fetching origin.
  Cache HIT  → return immediately (origin NOT hit)
  Cache MISS → fetch origin → cache.put() → return
  X-Cache-Status header: HIT or MISS

Layer 2 — cf.cacheTtl (fallback for external origins):
  When origin is on a different domain, cf.cacheTtl + cf.cacheEverything
  provides additional CDN caching. Both layers coexist.

Layer 3 — Origin stampede protection:
  Max 50 releases per alarm tick (DEFAULT_MAX_CONCURRENT_RELEASES).
  Even with releaseRate: 60000, origin never gets more than
  ~50 concurrent new visitors per second.
```

Config per event: `edgeCacheTtl` (default 60s), `browserCacheTtl` (default 0s).

### 2. WebSocket Reconnection

```
Connection lost
  │
  ├── Attempt 1:  1s delay  + jitter (0-25%)
  ├── Attempt 2:  2s delay  + jitter
  ├── Attempt 3:  4s delay  + jitter
  ├── Attempt N:  min(2^N s, 30s) + jitter
  │
  ├── After 3 WS failures → switch to HTTP polling (/queue/poll, every 3s)
  │
  └── Tab becomes visible → reconnect immediately (Visibility API)
```

Queue position is preserved for **120 seconds** after disconnect (grace period).

### 3. DO Hibernation Recovery

```
DO hibernated (idle, not billed)
  │
  ├── Wake from fetch() (new visitor connects)
  │     → Force reload config from KV
  │     → Recreate SQLite tables if needed
  │     → Recover event ID from _meta table
  │
  ├── Wake from webSocketMessage() (existing visitor sends message)
  │     → ensureInitialized()
  │     → Recover event ID from _meta table
  │     → Reload config from KV
  │
  └── Wake from alarm()
        → Same recovery + always reschedule if visitors waiting
        → KV transient error → retry on next alarm (not lost)
```

### 4. Transient Error Handling

```
KV read fails in DO
  │
  ├── During handleJoin()
  │     → Send TEMPORARY_ERROR to client
  │     → Client auto-retries after 3s
  │
  └── During alarm()
        → Log error
        → Reschedule alarm (visitors not stuck)
        → Next alarm retries config load
```

---

## Project Structure

```
├── src/
│   ├── shared/                  # Code shared by both Workers
│   │   ├── config.ts            # EventConfig type + validation + defaults
│   │   ├── constants.ts         # Cookie names, KV prefixes, limits
│   │   ├── errors.ts            # 12 typed error classes
│   │   ├── jwt.ts               # HMAC-SHA256 JWT sign/verify (Web Crypto)
│   │   └── messages.ts          # WebSocket message types + parse/serialize
│   ├── worker/                  # Worker 1: visitor-facing
│   │   ├── index.ts             # Hono routes: /queue, /queue/ws, /queue/poll, /*
│   │   ├── gateway.ts           # Token check → proxy or redirect to queue
│   │   ├── queue-page.ts        # Serve waiting room HTML, WS upgrade, polling
│   │   └── durable-object.ts    # Queue brain: SQLite, WS Hibernation, alarm release
│   └── admin/                   # Worker 2: admin API
│       ├── index.ts             # REST routes + CORS + error handler
│       ├── auth.ts              # Bearer token auth (timing-safe comparison)
│       └── handlers.ts          # CRUD + rate control + key rotation + stats
├── public/                      # Static queue page assets
│   ├── queue.html               # Waiting room template (server-injected config)
│   ├── queue.js                 # WS client: reconnect, backoff, polling fallback
│   └── queue.css                # Dark-themed responsive queue UI
├── test/
│   ├── unit/                    # 93 unit tests (jwt, config, errors, messages, signing-keys)
│   └── integration/             # 67 integration tests (admin API, gateway, E2E)
├── load-test/                   # k6 load test scripts
│   ├── existing-event.js        # Test against pre-configured event
│   ├── queue-flow.js            # Full lifecycle (create → test → delete)
│   └── gateway-throughput.js    # HTTP gateway throughput
├── demo-site/                   # Next.js 16 music ticket demo site
│   ├── src/
│   │   ├── app/                 # Pages: /, /events, /events/[slug], /checkout, /admin
│   │   ├── components/          # EventCard, QueueOverlay, TicketSelector, Header, Footer
│   │   └── lib/                 # events.ts (mock data), admin-api.ts, queue-status.ts
│   └── ...
├── Dockerfile                   # Multi-stage build for demo site
├── wrangler.toml                # Worker 1 config (routes to ticket.ironcode.cloud/*)
├── wrangler.admin.toml          # Worker 2 config (admin API)
└── vitest.config.ts             # Vitest + @cloudflare/vitest-pool-workers
```

---

## Key Design Decisions

- **Fail-open** — if the queue system breaks, visitors pass through to the origin (configurable per event: `failMode: "open" | "closed"`)
- **Edge caching (Cache API)** — origin responses cached at the edge via `caches.default`. First visitor fetches from origin; subsequent visitors served from cache. Configurable TTL per event (`edgeCacheTtl`, `browserCacheTtl`)
- **Origin stampede protection** — max 50 releases per alarm tick (`DEFAULT_MAX_CONCURRENT_RELEASES`), regardless of `releaseRate` setting
- **Key rotation** — signing keys stored as JSON array `[{key, active, createdAt}]`, max 3 keys retained. Gateway verifies against all keys; DO signs with the active key. Auto-migration from legacy plain string format
- **Schedule enforcement** — `eventStartTime`/`eventEndTime` enforced at gateway (403 for not started, passthrough for ended) and DO (rejects joins outside window, stops releasing after end)
- **Turnstile integration** — optional Cloudflare Turnstile verification on join. Fails open on API errors (allows visitor, logs warning)
- **Poll token** — HMAC-signed compact hex token issued at join time for HTTP polling fallback, verified by DO's `/visitor-status` endpoint
- **WebSocket Hibernation** — no billing while visitors idle; alarm-based release every 1s
- **JWT tokens** — HMAC-SHA256 via Web Crypto API, not a library dependency
- **Zero runtime deps** — only `hono` (14KB). Everything else is native (Web Crypto, crypto.randomUUID())
- **Fair FIFO** — first-come, first-served with reconnection support and disconnect grace period
- **Eventual consistency** — KV reads may be stale; DO always reschedules alarms when config load fails

---

## Quick Start

### Prerequisites

- Node.js >= 20
- npm
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)

### 1. Install dependencies

```bash
npm install
```

### 2. Run queue system (dev)

```bash
# Worker 1 — visitor-facing gateway + queue
npm run dev

# Worker 2 — admin API (separate terminal)
npm run dev:admin
```

### 3. Run demo site

```bash
cd demo-site
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the VIBE ticketing site.

### 4. Run tests

```bash
# All 170 tests
npm test

# Watch mode
npm run test:watch

# Type check
npm run typecheck
```

---

## Admin API

All endpoints under `/api/*` require `Authorization: Bearer <ADMIN_API_KEY>`.

Public endpoints (`/health`, `/api/public/*`) require no auth.

### Create event example

```bash
curl -X POST http://localhost:8787/api/events \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "summer-fest-2026",
    "name": "Summer Festival 2026",
    "protectedPaths": ["/tickets/*", "/checkout"],
    "originUrl": "https://your-origin.com",
    "releaseRate": 120,
    "tokenTtlSeconds": 1800
  }'
```

### Event config options

| Field | Type | Default | Description |
|---|---|---|---|
| `eventId` | string | *required* | URL-safe unique ID |
| `name` | string | *required* | Display name |
| `protectedPaths` | string[] | *required* | URL patterns to protect (supports `*` wildcards) |
| `originUrl` | string | *required* | HTTPS origin to proxy to |
| `releaseRate` | number | `60` | Visitors released per minute |
| `tokenTtlSeconds` | number | `1800` | Token validity (seconds) |
| `failMode` | `"open"` \| `"closed"` | `"open"` | Behavior when queue system fails (`closed` returns 503 + `Retry-After: 30`) |
| `mode` | `"always"` \| `"threshold"` | `"always"` | Queue activation mode |
| `maxQueueSize` | number | `0` | Max visitors in queue (0 = up to 50K DO limit) |
| `turnstileEnabled` | boolean | `false` | Require Cloudflare Turnstile verification on join |
| `enabled` | boolean | `true` | Whether queue is active |
| `eventStartTime` | string (ISO 8601) | `undefined` | Queue opens at this time (403 before) |
| `eventEndTime` | string (ISO 8601) | `undefined` | Queue ends at this time (passthrough after) |
| `edgeCacheTtl` | number | `60` | Seconds to cache origin responses at Cloudflare edge |
| `browserCacheTtl` | number | `0` | Seconds for browser `Cache-Control: max-age` |

---

## Deployment

### Cloudflare Workers

```bash
# Create KV namespace
wrangler kv namespace create CONFIG_KV

# Update wrangler.toml and wrangler.admin.toml with the namespace ID

# Set admin API key
wrangler secret put ADMIN_API_KEY --config wrangler.admin.toml

# Deploy both Workers
npm run deploy
```

### Demo Site (Docker)

The demo site ships as a standalone Docker image:

```bash
docker build -t ticket-queue .
docker run -p 3000:3000 -e NEXT_PUBLIC_ADMIN_API_URL=https://your-admin.workers.dev ticket-queue
```

### CI/CD

The `.github/workflows/deploy.yml` workflow runs on every push to `main`:

1. **Test** — typecheck + run all 170 tests in the Workers runtime
2. **Deploy Workers** — deploy both Cloudflare Workers (`queue-worker` + `queue-admin`)
3. **Deploy Demo Site** — build & push Docker image, then SSH deploy to server

On pull requests, only the test job runs.

**Required GitHub secrets:**

| Secret | Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Workers permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `DOCKER_USERNAME` | Docker Hub username |
| `DOCKER_PASSWORD` | Docker Hub password or access token |
| `SSH_HOST` | Deploy server hostname/IP |
| `SSH_USERNAME` | SSH user |
| `SSH_PASSWORD` | SSH password |
| `SSH_PORT` | SSH port |
| `DEPLOY_PATH` | Path to `deploy.sh` on the server |

---

## Tests

**170 tests** across 8 test files, all running in the Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers`:

```
 ✓ test/unit/errors.test.ts          (11 tests)
 ✓ test/unit/messages.test.ts        (12 tests)
 ✓ test/unit/jwt.test.ts             (11 tests)
 ✓ test/unit/config.test.ts          (60 tests)
 ✓ test/unit/signing-keys.test.ts    (9 tests)
 ✓ test/integration/worker.test.ts   (31 tests)
 ✓ test/integration/admin.test.ts    (32 tests)
 ✓ test/integration/e2e-flow.test.ts (4 tests)
```

### What's tested

- **JWT** — sign/verify round-trip, wrong secret, tampered payload, expiry, grace period, missing claims
- **Config validation** — required fields, HTTPS enforcement, invalid values, ISO 8601 date validation, edge cache TTL validation, `validateCreateEvent` + `validateUpdateEvent`
- **Error classes** — all 12 classes: status codes, JSON serialization, instanceof chains
- **Messages** — parse/serialize for all client + server message types, poll token field
- **Signing keys** — `parseSigningKeys` (legacy string + JSON array), `getActiveSigningKey`
- **Gateway** — protected/unprotected paths, valid/expired/tampered tokens, wildcard matching, disabled events, fail-open/closed, schedule enforcement, key rotation, edge caching headers
- **Admin API** — full CRUD, auth middleware, duplicate rejection, rate adjustment, stats, key rotation (caps at 3), update validation
- **E2E** — create event → verify KV + signing key, full lifecycle, JWT round-trip, multi-event isolation

---

## Constants Reference

| Constant | Value | Description |
|---|---|---|
| `TOKEN_COOKIE_NAME` | `__queue_token` | Cookie for access token |
| `EVENT_CONFIG_PREFIX` | `event:` | KV key prefix for configs |
| `SIGNING_KEY_PREFIX` | `signing_key:` | KV key prefix for HMAC keys |
| `DEFAULT_TOKEN_TTL_SECONDS` | `1800` (30 min) | Token validity |
| `TOKEN_GRACE_PERIOD_SECONDS` | `300` (5 min) | Post-expiry grace |
| `DEFAULT_RELEASE_RATE` | `60` / min | Default throughput |
| `ALARM_INTERVAL_MS` | `1000` (1s) | Release cycle frequency |
| `MAX_VISITORS_PER_DO` | `50,000` | Hard limit per DO instance |
| `DISCONNECT_GRACE_SECONDS` | `120` (2 min) | Position hold on disconnect |
| `DEFAULT_EDGE_CACHE_TTL` | `60` (1 min) | Edge cache for proxied responses |
| `DEFAULT_BROWSER_CACHE_TTL` | `0` | Browser cache (0 = revalidate with edge) |
| `DEFAULT_MAX_CONCURRENT_RELEASES` | `50` | Max releases per alarm tick (stampede protection) |

---

## Load Test Results

Load tested against production (`ticket.ironcode.cloud`) using [k6](https://k6.io/) with WebSocket connections. Each visitor opens a WebSocket, joins the queue, waits for release, and verifies the JWT token.

Event config: `releaseRate: 1000/min`, `neon-nights-2026`.

### Results by visitor count

| Visitors | Connected | Released | Success Rate | WS Connect p95 | Time to Release avg | Total Time |
|----------|-----------|----------|-------------|-----------------|---------------------|------------|
| 50 | 50 | 50 | 100% | 670ms | 2.7s | 3.8s |
| 200 | 200 | 200 | 100% | 1.34s | 6.95s | 12.7s |
| 500 | 500 | 500 | 100% | 3.28s | 16.4s | 31.8s |
| 2,000 | 5,919 | 5,910 | 99.84% | 12.75s | 1m34s | 5m20s |

### 2,000 VU details

The 2K test uses `ramping-vus` executor (ramp ~100 VUs/sec) to avoid TLS thundering herd from a single machine. The `ramping-vus` executor loops VUs, so 2,000 max VUs produced 6,108 total iterations over 5m20s.

```
Checks:
  ✓ worker healthy
  ✓ released token is valid JWT (100%)
  ✓ WebSocket connected (96% — 5,919 / 6,108)

Metrics:
  ws_connect_time p95 .... 12.75s
  time_to_position p95 ... 14.66s
  time_to_release p95 .... 2m2s
  error_messages ......... 9 (WebSocket abnormal closure — normal at scale)
  position_messages ...... 630,177 (1,798/s throughput)
```

### Bottleneck at scale

The 189 failed WebSocket connections (3%) at 2K VUs are a **client-side TLS bottleneck** — the local machine cannot open 2,000+ concurrent TLS+WebSocket connections simultaneously. The server-side (Cloudflare DO) handled all connected visitors correctly. Distributed load testing (e.g., Grafana Cloud k6) would eliminate this bottleneck.

### Load test scripts

```bash
# Run against existing event (no create/delete)
k6 run load-test/existing-event.js \
  --env EVENT_ID=neon-nights-2026 \
  --env VISITORS=500 \
  --env WORKER_URL=https://ticket.ironcode.cloud

# Full lifecycle (creates event, runs, deletes)
k6 run load-test/queue-flow.js \
  --env VISITORS=200 \
  --env WORKER_URL=https://ticket.ironcode.cloud \
  --env ADMIN_URL=https://ticket-queue-admin.nhasang.workers.dev

# Gateway HTTP throughput (no WebSocket)
k6 run load-test/gateway-throughput.js \
  --env EVENT_ID=neon-nights-2026 \
  --env WORKER_URL=https://ticket.ironcode.cloud
```

---

## Future Work

| Priority | Feature | Effort |
|---|---|---|
| P1 | **Threshold Mode** — only activate queue when concurrent visitors exceed a configurable threshold | M |
| P1 | **Pre-queue Randomization** — randomize positions at sale start for scheduled onsales | M |
| P2 | **Broadcast O(N) Fix** — `broadcastPositionUpdates` currently does O(N) SQL queries per alarm tick; batch into single query | M |
| P2 | **Cookie max-age sync** — sync cookie `max-age` with `tokenTtlSeconds` config | S |
| P2 | **Admin Rate Limiting** — rate limit admin API endpoints | S |
| P2 | **One-Order-Per-Customer** — identity verification to prevent scalping | L |
| P2 | **Queue Sharding** — for >50K concurrent visitors per event | XL |
| P3 | **Inline Queue Page Drift** — inline fallback HTML may drift from `queue.html` template | S |

---

## License

MIT
