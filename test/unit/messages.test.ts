import { describe, test, expect } from "vitest";
import {
  parseClientMessage,
  serializeServerMessage,
  type ServerMessage,
} from "../../src/shared/messages.js";

describe("WebSocket messages", () => {
  describe("parseClientMessage", () => {
    test("parses join message", () => {
      const msg = parseClientMessage(JSON.stringify({ type: "join" }));
      expect(msg).toEqual({ type: "join" });
    });

    test("parses join with visitorId", () => {
      const msg = parseClientMessage(JSON.stringify({ type: "join", visitorId: "abc-123" }));
      expect(msg).toEqual({ type: "join", visitorId: "abc-123" });
    });

    test("parses join with turnstileToken", () => {
      const msg = parseClientMessage(JSON.stringify({ type: "join", turnstileToken: "token-xyz" }));
      expect(msg).toEqual({ type: "join", turnstileToken: "token-xyz" });
    });

    test("parses ping message", () => {
      const msg = parseClientMessage(JSON.stringify({ type: "ping" }));
      expect(msg).toEqual({ type: "ping" });
    });

    test("returns null for invalid JSON", () => {
      expect(parseClientMessage("not json")).toBeNull();
    });

    test("returns null for non-object", () => {
      expect(parseClientMessage('"string"')).toBeNull();
      expect(parseClientMessage("42")).toBeNull();
      expect(parseClientMessage("null")).toBeNull();
    });

    test("returns null for unknown message type", () => {
      expect(parseClientMessage(JSON.stringify({ type: "unknown" }))).toBeNull();
    });

    test("returns null for missing type", () => {
      expect(parseClientMessage(JSON.stringify({ data: "something" }))).toBeNull();
    });
  });

  describe("serializeServerMessage", () => {
    test("serializes position message", () => {
      const msg: ServerMessage = {
        type: "position",
        visitorId: "v-1",
        position: 5,
        totalAhead: 4,
        estimatedWaitSeconds: 120,
      };
      const json = JSON.parse(serializeServerMessage(msg));
      expect(json.type).toBe("position");
      expect(json.position).toBe(5);
      expect(json.totalAhead).toBe(4);
    });

    test("serializes released message", () => {
      const msg: ServerMessage = { type: "released", token: "jwt.token.here" };
      const json = JSON.parse(serializeServerMessage(msg));
      expect(json.type).toBe("released");
      expect(json.token).toBe("jwt.token.here");
    });

    test("serializes error message", () => {
      const msg: ServerMessage = { type: "error", code: "QUEUE_FULL", message: "Full" };
      const json = JSON.parse(serializeServerMessage(msg));
      expect(json.type).toBe("error");
      expect(json.code).toBe("QUEUE_FULL");
    });

    test("serializes pong message", () => {
      const msg: ServerMessage = { type: "pong" };
      expect(JSON.parse(serializeServerMessage(msg))).toEqual({ type: "pong" });
    });
  });
});
