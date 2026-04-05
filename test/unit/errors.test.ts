import { describe, test, expect } from "vitest";
import {
  QueueError,
  TokenParseError,
  TokenSignatureError,
  TokenExpiredError,
  SigningKeyNotFoundError,
  EventNotFoundError,
  QueueCapacityError,
  ValidationError,
  UnauthorizedError,
  RateLimitError,
} from "../../src/shared/errors.js";

describe("Error classes", () => {
  test("QueueError has statusCode and code", () => {
    const err = new QueueError("test", 500, "TEST_ERROR");
    expect(err.message).toBe("test");
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe("TEST_ERROR");
    expect(err.name).toBe("QueueError");
  });

  test("QueueError toJSON produces API-friendly object", () => {
    const err = new QueueError("test", 400, "BAD");
    const json = err.toJSON();
    expect(json).toEqual({
      error: "BAD",
      message: "test",
      statusCode: 400,
    });
  });

  test("TokenParseError is 401 with reason", () => {
    const err = new TokenParseError("bad format");
    expect(err.statusCode).toBe(401);
    expect(err.message).toContain("bad format");
    expect(err.name).toBe("TokenParseError");
    expect(err).toBeInstanceOf(QueueError);
  });

  test("TokenSignatureError is 401", () => {
    const err = new TokenSignatureError();
    expect(err.statusCode).toBe(401);
    expect(err.name).toBe("TokenSignatureError");
  });

  test("TokenExpiredError carries expiredAt timestamp", () => {
    const ts = 1700000000;
    const err = new TokenExpiredError(ts);
    expect(err.statusCode).toBe(401);
    expect(err.expiredAt).toBe(ts);
    expect(err.message).toContain("2023");
  });

  test("SigningKeyNotFoundError is 500 with event ID", () => {
    const err = new SigningKeyNotFoundError("event-123");
    expect(err.statusCode).toBe(500);
    expect(err.message).toContain("event-123");
  });

  test("EventNotFoundError is 404", () => {
    const err = new EventNotFoundError("missing-event");
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain("missing-event");
  });

  test("QueueCapacityError shows current/max", () => {
    const err = new QueueCapacityError(50000, 50000);
    expect(err.statusCode).toBe(503);
    expect(err.message).toContain("50000/50000");
  });

  test("ValidationError includes field errors", () => {
    const err = new ValidationError("Bad input", { name: "required" });
    expect(err.statusCode).toBe(400);
    expect(err.fields).toEqual({ name: "required" });
    const json = err.toJSON();
    expect(json.fields).toEqual({ name: "required" });
  });

  test("UnauthorizedError is 401", () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe("Unauthorized");
  });

  test("RateLimitError is 429 with retryAfter", () => {
    const err = new RateLimitError(30);
    expect(err.statusCode).toBe(429);
    expect(err.retryAfter).toBe(30);
    expect(err.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(err.name).toBe("RateLimitError");
    expect(err).toBeInstanceOf(QueueError);
    const json = err.toJSON();
    expect(json.retryAfter).toBe(30);
    expect(json.statusCode).toBe(429);
  });

  test("all error classes are instanceof Error", () => {
    const errors = [
      new TokenParseError("x"),
      new TokenSignatureError(),
      new TokenExpiredError(0),
      new SigningKeyNotFoundError("x"),
      new EventNotFoundError("x"),
      new QueueCapacityError(0, 0),
      new ValidationError("x"),
      new UnauthorizedError(),
      new RateLimitError(60),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(QueueError);
    }
  });
});
