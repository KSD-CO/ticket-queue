import { describe, test, expect } from "vitest";
import { validateCreateEvent, validateUpdateEvent, DEFAULT_EVENT_CONFIG } from "../../src/shared/config.js";

describe("EventConfig", () => {
  describe("validateCreateEvent", () => {
    const validInput = {
      eventId: "concert-2025",
      name: "Rock Concert 2025",
      protectedPaths: ["/tickets/*"],
      originUrl: "https://tickets.example.com",
    };

    test("accepts valid minimal input", () => {
      const result = validateCreateEvent(validInput);
      expect(result.valid).toBe(true);
    });

    test("accepts valid input with all optional fields", () => {
      const result = validateCreateEvent({
        ...validInput,
        releaseRate: 120,
        mode: "threshold",
        activationThreshold: 500,
        tokenTtlSeconds: 3600,
        failMode: "closed",
        turnstileEnabled: true,
        turnstileSiteKey: "site-key",
        turnstileSecretKey: "secret-key",
        maxQueueSize: 100000,
        eventStartTime: "2025-06-01T10:00:00Z",
        eventEndTime: "2025-06-01T23:00:00Z",
      });
      expect(result.valid).toBe(true);
    });

    test("rejects null/undefined input", () => {
      expect(validateCreateEvent(null).valid).toBe(false);
      expect(validateCreateEvent(undefined).valid).toBe(false);
    });

    test("rejects non-object input", () => {
      expect(validateCreateEvent("string").valid).toBe(false);
      expect(validateCreateEvent(42).valid).toBe(false);
    });

    test("rejects missing eventId", () => {
      const { eventId, ...rest } = validInput;
      const result = validateCreateEvent(rest);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.eventId).toBeDefined();
    });

    test("rejects non-URL-safe eventId", () => {
      const result = validateCreateEvent({ ...validInput, eventId: "has spaces!" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.eventId).toContain("URL-safe");
    });

    test("rejects missing name", () => {
      const result = validateCreateEvent({ ...validInput, name: "" });
      expect(result.valid).toBe(false);
    });

    test("rejects empty protectedPaths", () => {
      const result = validateCreateEvent({ ...validInput, protectedPaths: [] });
      expect(result.valid).toBe(false);
    });

    test("accepts HTTP originUrl", () => {
      const result = validateCreateEvent({ ...validInput, originUrl: "http://insecure.com" });
      expect(result.valid).toBe(true);
    });

    test("rejects invalid originUrl", () => {
      const result = validateCreateEvent({ ...validInput, originUrl: "not-a-url" });
      expect(result.valid).toBe(false);
    });

    test("rejects negative releaseRate", () => {
      const result = validateCreateEvent({ ...validInput, releaseRate: -1 });
      expect(result.valid).toBe(false);
    });

    test("rejects tokenTtlSeconds below minimum", () => {
      const result = validateCreateEvent({ ...validInput, tokenTtlSeconds: 10 });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.tokenTtlSeconds).toContain("60");
    });

    test("rejects invalid failMode", () => {
      const result = validateCreateEvent({ ...validInput, failMode: "invalid" });
      expect(result.valid).toBe(false);
    });

    test("rejects invalid mode", () => {
      const result = validateCreateEvent({ ...validInput, mode: "invalid" });
      expect(result.valid).toBe(false);
    });

    test("reports multiple errors at once", () => {
      const result = validateCreateEvent({ eventId: "", originUrl: "bad" });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(Object.keys(result.errors).length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("validateCreateEvent — ISO 8601 dates", () => {
    const validInput = {
      eventId: "concert-2025",
      name: "Rock Concert 2025",
      protectedPaths: ["/tickets/*"],
      originUrl: "https://tickets.example.com",
    };

    test("accepts valid ISO 8601 eventStartTime", () => {
      const result = validateCreateEvent({ ...validInput, eventStartTime: "2025-06-01T10:00:00Z" });
      expect(result.valid).toBe(true);
    });

    test("accepts valid ISO 8601 eventEndTime", () => {
      const result = validateCreateEvent({ ...validInput, eventEndTime: "2025-12-31T23:59:59Z" });
      expect(result.valid).toBe(true);
    });

    test("accepts both start and end times", () => {
      const result = validateCreateEvent({
        ...validInput,
        eventStartTime: "2025-06-01T10:00:00Z",
        eventEndTime: "2025-06-01T23:00:00Z",
      });
      expect(result.valid).toBe(true);
    });

    test("rejects non-string eventStartTime", () => {
      const result = validateCreateEvent({ ...validInput, eventStartTime: 12345 });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.eventStartTime).toContain("ISO 8601");
    });

    test("rejects invalid date string for eventStartTime", () => {
      const result = validateCreateEvent({ ...validInput, eventStartTime: "not-a-date" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.eventStartTime).toContain("ISO 8601");
    });

    test("rejects non-string eventEndTime", () => {
      const result = validateCreateEvent({ ...validInput, eventEndTime: true });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.eventEndTime).toContain("ISO 8601");
    });

    test("rejects invalid date string for eventEndTime", () => {
      const result = validateCreateEvent({ ...validInput, eventEndTime: "yesterday" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.eventEndTime).toContain("ISO 8601");
    });
  });

  describe("validateCreateEvent — edge cache TTLs", () => {
    const validInput = {
      eventId: "concert-2025",
      name: "Rock Concert 2025",
      protectedPaths: ["/tickets/*"],
      originUrl: "https://tickets.example.com",
    };

    test("accepts valid edgeCacheTtl", () => {
      const result = validateCreateEvent({ ...validInput, edgeCacheTtl: 120 });
      expect(result.valid).toBe(true);
    });

    test("accepts zero edgeCacheTtl (disable edge cache)", () => {
      const result = validateCreateEvent({ ...validInput, edgeCacheTtl: 0 });
      expect(result.valid).toBe(true);
    });

    test("rejects negative edgeCacheTtl", () => {
      const result = validateCreateEvent({ ...validInput, edgeCacheTtl: -1 });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.edgeCacheTtl).toContain("non-negative");
    });

    test("rejects non-number edgeCacheTtl", () => {
      const result = validateCreateEvent({ ...validInput, edgeCacheTtl: "long" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.edgeCacheTtl).toBeDefined();
    });

    test("accepts valid browserCacheTtl", () => {
      const result = validateCreateEvent({ ...validInput, browserCacheTtl: 30 });
      expect(result.valid).toBe(true);
    });

    test("accepts zero browserCacheTtl (no browser cache)", () => {
      const result = validateCreateEvent({ ...validInput, browserCacheTtl: 0 });
      expect(result.valid).toBe(true);
    });

    test("rejects negative browserCacheTtl", () => {
      const result = validateCreateEvent({ ...validInput, browserCacheTtl: -5 });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.browserCacheTtl).toContain("non-negative");
    });
  });

  describe("validateUpdateEvent", () => {
    test("accepts valid partial update", () => {
      const result = validateUpdateEvent({ name: "New Name" });
      expect(result.valid).toBe(true);
    });

    test("accepts empty object (no-op update)", () => {
      const result = validateUpdateEvent({});
      expect(result.valid).toBe(true);
    });

    test("rejects null/undefined input", () => {
      expect(validateUpdateEvent(null).valid).toBe(false);
      expect(validateUpdateEvent(undefined).valid).toBe(false);
    });

    test("rejects non-object input", () => {
      expect(validateUpdateEvent("string").valid).toBe(false);
      expect(validateUpdateEvent(42).valid).toBe(false);
    });

    test("rejects eventId in update payload", () => {
      const result = validateUpdateEvent({ eventId: "hijacked-id", name: "Test" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.eventId).toBe("eventId cannot be changed");
    });

    test("rejects empty name", () => {
      const result = validateUpdateEvent({ name: "" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.name).toBeDefined();
    });

    test("rejects non-string name", () => {
      const result = validateUpdateEvent({ name: 123 });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.name).toBeDefined();
    });

    test("rejects empty protectedPaths array", () => {
      const result = validateUpdateEvent({ protectedPaths: [] });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.protectedPaths).toBeDefined();
    });

    test("rejects non-string elements in protectedPaths", () => {
      const result = validateUpdateEvent({ protectedPaths: [123] });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.protectedPaths).toBeDefined();
    });

    test("rejects invalid originUrl", () => {
      const result = validateUpdateEvent({ originUrl: "not-a-url" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.originUrl).toContain("valid URL");
    });

    test("rejects empty originUrl", () => {
      const result = validateUpdateEvent({ originUrl: "" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.originUrl).toBeDefined();
    });

    test("rejects negative releaseRate", () => {
      const result = validateUpdateEvent({ releaseRate: -1 });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.releaseRate).toBeDefined();
    });

    test("rejects string releaseRate", () => {
      const result = validateUpdateEvent({ releaseRate: "fast" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.releaseRate).toBeDefined();
    });

    test("accepts zero releaseRate (pause queue)", () => {
      const result = validateUpdateEvent({ releaseRate: 0 });
      expect(result.valid).toBe(true);
    });

    test("rejects tokenTtlSeconds below 60", () => {
      const result = validateUpdateEvent({ tokenTtlSeconds: 30 });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.tokenTtlSeconds).toContain("60");
    });

    test("rejects non-number tokenTtlSeconds", () => {
      const result = validateUpdateEvent({ tokenTtlSeconds: "long" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.tokenTtlSeconds).toBeDefined();
    });

    test("accepts tokenTtlSeconds at minimum (60)", () => {
      const result = validateUpdateEvent({ tokenTtlSeconds: 60 });
      expect(result.valid).toBe(true);
    });

    test("rejects invalid failMode", () => {
      const result = validateUpdateEvent({ failMode: "maybe" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.failMode).toBeDefined();
    });

    test("accepts valid failMode values", () => {
      expect(validateUpdateEvent({ failMode: "open" }).valid).toBe(true);
      expect(validateUpdateEvent({ failMode: "closed" }).valid).toBe(true);
    });

    test("rejects invalid mode", () => {
      const result = validateUpdateEvent({ mode: "turbo" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.mode).toBeDefined();
    });

    test("accepts valid mode values", () => {
      expect(validateUpdateEvent({ mode: "always" }).valid).toBe(true);
      expect(validateUpdateEvent({ mode: "threshold" }).valid).toBe(true);
    });

    test("rejects invalid eventStartTime", () => {
      const result = validateUpdateEvent({ eventStartTime: "not-a-date" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.eventStartTime).toContain("ISO 8601");
    });

    test("rejects invalid eventEndTime", () => {
      const result = validateUpdateEvent({ eventEndTime: "tomorrow" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.eventEndTime).toContain("ISO 8601");
    });

    test("accepts valid ISO 8601 dates in update", () => {
      const result = validateUpdateEvent({
        eventStartTime: "2025-06-01T10:00:00Z",
        eventEndTime: "2025-06-01T23:00:00Z",
      });
      expect(result.valid).toBe(true);
    });

    test("reports multiple errors at once", () => {
      const result = validateUpdateEvent({
        eventId: "change-attempt",
        releaseRate: -5,
        tokenTtlSeconds: 10,
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(Object.keys(result.errors).length).toBe(3);
      }
    });

    test("rejects negative edgeCacheTtl in update", () => {
      const result = validateUpdateEvent({ edgeCacheTtl: -10 });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.edgeCacheTtl).toContain("non-negative");
    });

    test("accepts valid edgeCacheTtl in update", () => {
      const result = validateUpdateEvent({ edgeCacheTtl: 300 });
      expect(result.valid).toBe(true);
    });

    test("rejects negative browserCacheTtl in update", () => {
      const result = validateUpdateEvent({ browserCacheTtl: -1 });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.browserCacheTtl).toContain("non-negative");
    });

    test("accepts valid browserCacheTtl in update", () => {
      const result = validateUpdateEvent({ browserCacheTtl: 60 });
      expect(result.valid).toBe(true);
    });
  });

  describe("DEFAULT_EVENT_CONFIG", () => {
    test("has sensible defaults", () => {
      expect(DEFAULT_EVENT_CONFIG.enabled).toBe(true);
      expect(DEFAULT_EVENT_CONFIG.releaseRate).toBe(60);
      expect(DEFAULT_EVENT_CONFIG.failMode).toBe("open");
      expect(DEFAULT_EVENT_CONFIG.turnstileEnabled).toBe(false);
      expect(DEFAULT_EVENT_CONFIG.tokenTtlSeconds).toBe(1800);
    });

    test("includes edge caching defaults", () => {
      expect(DEFAULT_EVENT_CONFIG.edgeCacheTtl).toBe(60);
      expect(DEFAULT_EVENT_CONFIG.browserCacheTtl).toBe(0);
    });
  });
});
