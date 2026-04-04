# AGENTS.md — Coding Agent Guidelines

## Project Overview

TypeScript project running on Cloudflare Workers. Two workers share code from `src/shared/`:
- **Worker 1** (`src/worker/`): Visitor-facing gateway — token verification, queue page serving, WebSocket connections, Durable Object state management.
- **Worker 2** (`src/admin/`): Admin REST API — CRUD for queue events, rate control, stats.
- **Demo site** (`demo-site/`): Separate Next.js 16 + React 19 + Tailwind v4 app with its own `package.json`.

Runtime: Cloudflare Workers (ESM). Framework: Hono. Only runtime dependency is `hono`; everything else (JWT, crypto, WebSocket) uses native Workers APIs.

## Build / Dev / Deploy Commands

```bash
npm run dev            # Run Worker 1 locally (wrangler dev)
npm run dev:admin      # Run Worker 2 locally (wrangler dev --config wrangler.admin.toml)
npm run deploy         # Deploy both workers to Cloudflare
npm run deploy:worker  # Deploy Worker 1 only
npm run deploy:admin   # Deploy Worker 2 only
npm run typecheck      # tsc --noEmit
```

## Test Commands

Test runner: Vitest with `@cloudflare/vitest-pool-workers` (tests run inside Workers runtime via Miniflare).

```bash
npm test                                    # Run all 153 tests (unit + integration)
npm run test:watch                          # Watch mode

# Run a single test file
npx vitest run test/unit/jwt.test.ts

# Run tests matching a name pattern
npx vitest run -t "round-trip"

# Run a specific test in a specific file
npx vitest run test/unit/jwt.test.ts -t "rejects token with wrong secret"
```

Test layout:
- `test/unit/` — jwt, config, errors, messages, signing-keys (pure logic, no I/O)
- `test/integration/` — admin API, gateway, E2E flow (use `SELF.fetch` or `app.fetch`)
- `test/env.d.ts` — type augmentation for cloudflare:test bindings

## CI Pipeline

`.github/workflows/deploy.yml` runs on push/PR to `main`:
1. `npm ci` → `npm run typecheck` → `npm test`
2. Deploy workers (push to `main` only)
3. Build and deploy demo site Docker image (push to `main` only)

Always run `npm run typecheck && npm test` before committing.

## Code Style

### File Naming
- **kebab-case** for all TypeScript files: `queue-page.ts`, `durable-object.ts`

### Naming Conventions
- **camelCase**: variables, functions, parameters (`handleGateway`, `visitorId`, `signingKey`)
- **PascalCase**: types, interfaces, classes, enums (`EventConfig`, `QueueDurableObject`, `ClientMessage`)
- **UPPER_SNAKE_CASE**: constants (`TOKEN_COOKIE_NAME`, `ALARM_INTERVAL_MS`, `MAX_VISITORS_PER_DO`)
- **snake_case**: SQLite column names only (`visitor_id`, `released_at`, `joined_at`)

### Imports
1. Framework/platform imports first (`hono`, `cloudflare:workers`)
2. Shared module imports next (`../shared/`)
3. Local/sibling imports last
4. Use explicit `import type { ... }` for type-only imports
5. **All imports must use `.js` extension** — required for ESM resolution in Workers

```typescript
import type { Context } from "hono";
import { verifyToken } from "../shared/jwt.js";
import { TOKEN_COOKIE_NAME } from "../shared/constants.js";
import type { EventConfig } from "../shared/config.js";
```

### Formatting
- 2-space indentation
- Double quotes for strings
- Semicolons required
- Trailing commas in parameters, arrays, objects
- Async/await throughout (no `.then()` chains in TypeScript; `.then()` only in vanilla JS client code)

### Types
- Use `interface` for data shapes, not `type` aliases for objects
- Discriminated union types for messages: `ClientMessage = JoinMessage | PingMessage`
- Use `Partial<>`, `Omit<>` for input/update types
- Avoid `any` — only acceptable when forced by platform API limitations
- `noUncheckedIndexedAccess: true` is enabled — array/object indexing returns `T | undefined`
- Cast SQL results explicitly: `.toArray() as unknown as VisitorRecord[]`
- Path aliases exist (`@shared/*`, `@worker/*`, `@admin/*`) but source uses relative paths with `.js` extensions

### Error Handling
- Custom error hierarchy: `QueueError` base class with 12 typed subclasses, each with `statusCode` and `code`
- Use `instanceof` checks for specific error types, never generic string matching
- Gateway respects `failMode` config: `"open"` (default) proxies to origin on errors, `"closed"` returns 503 with `Retry-After: 30`
- Admin API has a global `app.onError` handler converting `QueueError` to JSON responses
- Error classes implement `toJSON()` for clean API responses
- Prefix console logs with context: `[Gateway]`, `[QueueDO]`, `[Admin]`
- No bare `throw new Error()` — always use or create a specific `QueueError` subclass

### Documentation in Code
- Every `.ts` file starts with a block comment header explaining purpose, architecture context, and data flow:
  ```typescript
  // ============================================================
  // Gateway — token verification, proxy, and queue redirect
  //
  // Decision tree:
  //   Request ──▶ has token cookie? ...
  // ============================================================
  ```
- Use JSDoc (`/** */`) with `@param`, `@returns`, `@throws` on public functions
- Inline comments only for non-obvious logic

### Constants
- Use `as const` for immutable objects (e.g., `WS_CLOSE_CODES`)
- Use `public readonly` on class fields in error classes
- All magic values belong in `src/shared/constants.ts`

## Architecture Rules

### Module Boundaries
- `src/shared/` is imported by both workers — never import from `worker/` or `admin/` here
- `src/worker/` may import from `shared/` only
- `src/admin/` may import from `shared/` only
- Workers never import from each other

### Entry Points
- Worker 1: `src/worker/index.ts` (Hono app default export + `QueueDurableObject` re-export)
- Worker 2: `src/admin/index.ts` (Hono app default export)
- Config: `wrangler.toml` (Worker 1), `wrangler.admin.toml` (Worker 2)

### Key Patterns
- Durable Object uses SQLite storage + WebSocket Hibernation API
- JWT: HMAC-SHA256 via Web Crypto API (no external JWT library)
- Inter-worker communication: Worker 2 calls Worker 1's Durable Object via service bindings
- Static assets (`public/`) are served by Worker 1 for the queue waiting room
- **Key rotation**: Signing keys stored in KV as JSON array `[{key, active, createdAt}]` with auto-migration from legacy plain string format. Max 3 keys retained. Gateway verifies against all keys; DO signs with the active key.
- **Schedule enforcement**: `eventStartTime`/`eventEndTime` checked by gateway (403 for not started, passthrough for ended) and DO (rejects joins outside window, stops releasing after end)
- **Turnstile integration**: When `turnstileEnabled=true`, DO verifies Turnstile tokens via Cloudflare siteverify API. Fails open on API errors (allows visitor, logs warning).
- **Poll token**: HMAC-signed compact hex token issued at join time for HTTP polling fallback. Verified by DO's `/visitor-status` endpoint.
- **Update validation**: `validateUpdateEvent()` enforces the same field rules as create, plus rejecting `eventId` changes.

## Demo Site (`demo-site/`)

Separate Next.js project — has its own `package.json`, `tsconfig.json`, and `eslint.config.mjs`.

```bash
cd demo-site
npm run dev     # next dev
npm run build   # next build
npm run lint    # eslint
```

Do not confuse demo site dependencies/config with the main Workers project.
