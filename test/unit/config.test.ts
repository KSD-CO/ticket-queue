import { describe, test, expect } from "vitest";
import { validateCreateEvent, DEFAULT_EVENT_CONFIG } from "../../src/shared/config.js";

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

    test("rejects non-HTTPS originUrl", () => {
      const result = validateCreateEvent({ ...validInput, originUrl: "http://insecure.com" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors.originUrl).toContain("HTTPS");
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

  describe("DEFAULT_EVENT_CONFIG", () => {
    test("has sensible defaults", () => {
      expect(DEFAULT_EVENT_CONFIG.enabled).toBe(true);
      expect(DEFAULT_EVENT_CONFIG.releaseRate).toBe(60);
      expect(DEFAULT_EVENT_CONFIG.failMode).toBe("open");
      expect(DEFAULT_EVENT_CONFIG.turnstileEnabled).toBe(false);
      expect(DEFAULT_EVENT_CONFIG.tokenTtlSeconds).toBe(1800);
    });
  });
});
