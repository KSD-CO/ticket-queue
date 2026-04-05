// ============================================================
// Error classes for the ticket queue system
//
// Every error has a name, a user-facing message, and an HTTP
// status code. No generic catch-alls — each failure mode is
// a distinct class for explicit handling.
//
// Error hierarchy:
//   QueueError (base)
//   ├── TokenParseError        (malformed JWT)
//   ├── TokenSignatureError    (invalid HMAC signature)
//   ├── TokenExpiredError      (JWT past expiry + grace)
//   ├── SigningKeyNotFoundError (KV missing signing key)
//   ├── EventNotFoundError     (no config for event ID)
//   ├── EventInactiveError     (event disabled or ended)
//   ├── QueueCapacityError     (DO at max visitors)
//   ├── StorageFullError       (DO SQLite 10GB limit)
//   ├── VisitorNotFoundError   (reconnect with unknown ID)
//   ├── OriginError            (upstream 5xx or timeout)
//   ├── ValidationError        (invalid admin API payload)
//   ├── UnauthorizedError      (missing/bad API key)
//   └── RateLimitError         (admin API rate limit exceeded)
// ============================================================

export class QueueError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = "QueueError";
    this.statusCode = statusCode;
    this.code = code;
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      statusCode: this.statusCode,
    };
  }
}

export class TokenParseError extends QueueError {
  constructor(reason: string) {
    super(`Token malformed: ${reason}`, 401, "TOKEN_PARSE_ERROR");
    this.name = "TokenParseError";
  }
}

export class TokenSignatureError extends QueueError {
  constructor() {
    super("Token signature invalid", 401, "TOKEN_SIGNATURE_ERROR");
    this.name = "TokenSignatureError";
  }
}

export class TokenExpiredError extends QueueError {
  public readonly expiredAt: number;

  constructor(expiredAt: number) {
    super(`Token expired at ${new Date(expiredAt * 1000).toISOString()}`, 401, "TOKEN_EXPIRED_ERROR");
    this.name = "TokenExpiredError";
    this.expiredAt = expiredAt;
  }
}

export class SigningKeyNotFoundError extends QueueError {
  constructor(eventId: string) {
    super(`Signing key not found for event: ${eventId}`, 500, "SIGNING_KEY_NOT_FOUND");
    this.name = "SigningKeyNotFoundError";
  }
}

export class EventNotFoundError extends QueueError {
  constructor(eventId: string) {
    super(`Event not found: ${eventId}`, 404, "EVENT_NOT_FOUND");
    this.name = "EventNotFoundError";
  }
}

export class EventInactiveError extends QueueError {
  constructor(eventId: string) {
    super(`Event is not active: ${eventId}`, 403, "EVENT_INACTIVE");
    this.name = "EventInactiveError";
  }
}

export class QueueCapacityError extends QueueError {
  constructor(current: number, max: number) {
    super(`Queue at capacity: ${current}/${max}`, 503, "QUEUE_CAPACITY");
    this.name = "QueueCapacityError";
  }
}

export class StorageFullError extends QueueError {
  constructor() {
    super("Durable Object storage full", 503, "STORAGE_FULL");
    this.name = "StorageFullError";
  }
}

export class VisitorNotFoundError extends QueueError {
  constructor(visitorId: string) {
    super(`Visitor not found: ${visitorId}`, 404, "VISITOR_NOT_FOUND");
    this.name = "VisitorNotFoundError";
  }
}

export class OriginError extends QueueError {
  public readonly originStatus: number;

  constructor(originStatus: number, message: string) {
    const statusCode = originStatus >= 500 ? 502 : 504;
    super(`Origin error (${originStatus}): ${message}`, statusCode, "ORIGIN_ERROR");
    this.name = "OriginError";
    this.originStatus = originStatus;
  }
}

export class ValidationError extends QueueError {
  public readonly fields: Record<string, string>;

  constructor(message: string, fields: Record<string, string> = {}) {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
    this.fields = fields;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      fields: this.fields,
    };
  }
}

export class UnauthorizedError extends QueueError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export class RateLimitError extends QueueError {
  public readonly retryAfter: number;

  constructor(retryAfter: number) {
    super(`Rate limit exceeded. Try again in ${retryAfter} seconds.`, 429, "RATE_LIMIT_EXCEEDED");
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      retryAfter: this.retryAfter,
    };
  }
}
