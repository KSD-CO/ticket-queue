import { describe, test, expect } from "vitest";
import { parseSigningKeys, getActiveSigningKey } from "../../src/admin/handlers.js";

describe("Signing key utilities", () => {
  describe("parseSigningKeys", () => {
    test("parses legacy plain string key", () => {
      const keys = parseSigningKeys("my-secret-key-abc123");
      expect(keys).toHaveLength(1);
      expect(keys[0]!.key).toBe("my-secret-key-abc123");
      expect(keys[0]!.active).toBe(true);
    });

    test("parses new JSON array format", () => {
      const raw = JSON.stringify([
        { key: "key-1", active: false, createdAt: "2025-01-01T00:00:00Z" },
        { key: "key-2", active: true, createdAt: "2025-02-01T00:00:00Z" },
      ]);
      const keys = parseSigningKeys(raw);
      expect(keys).toHaveLength(2);
      expect(keys[0]!.key).toBe("key-1");
      expect(keys[0]!.active).toBe(false);
      expect(keys[1]!.key).toBe("key-2");
      expect(keys[1]!.active).toBe(true);
    });

    test("treats non-array JSON as legacy string", () => {
      // A JSON string literal like "\"key\"" should be treated as legacy
      const keys = parseSigningKeys('"just-a-json-string"');
      expect(keys).toHaveLength(1);
      expect(keys[0]!.key).toBe('"just-a-json-string"');
      expect(keys[0]!.active).toBe(true);
    });

    test("treats JSON object as legacy string", () => {
      const keys = parseSigningKeys('{"key": "value"}');
      expect(keys).toHaveLength(1);
      // Not an array, so treated as raw string
      expect(keys[0]!.key).toBe('{"key": "value"}');
    });

    test("handles empty string", () => {
      const keys = parseSigningKeys("");
      expect(keys).toHaveLength(1);
      expect(keys[0]!.key).toBe("");
    });
  });

  describe("getActiveSigningKey", () => {
    test("returns the active key", () => {
      const keys = [
        { key: "old-key", active: false, createdAt: "2025-01-01T00:00:00Z" },
        { key: "new-key", active: true, createdAt: "2025-02-01T00:00:00Z" },
      ];
      expect(getActiveSigningKey(keys)).toBe("new-key");
    });

    test("returns first active key if multiple are active", () => {
      const keys = [
        { key: "key-a", active: true, createdAt: "2025-01-01T00:00:00Z" },
        { key: "key-b", active: true, createdAt: "2025-02-01T00:00:00Z" },
      ];
      expect(getActiveSigningKey(keys)).toBe("key-a");
    });

    test("returns null if no active key exists", () => {
      const keys = [
        { key: "retired-1", active: false, createdAt: "2025-01-01T00:00:00Z" },
        { key: "retired-2", active: false, createdAt: "2025-02-01T00:00:00Z" },
      ];
      expect(getActiveSigningKey(keys)).toBeNull();
    });

    test("returns null for empty array", () => {
      expect(getActiveSigningKey([])).toBeNull();
    });
  });
});
