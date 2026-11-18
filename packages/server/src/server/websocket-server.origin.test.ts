import { describe, expect, test } from "vitest";

import { isWebSocketSameOrigin } from "./websocket-server.js";

describe("isWebSocketSameOrigin", () => {
  test("accepts exact same-origin websocket upgrades", () => {
    expect(isWebSocketSameOrigin("http://localhost:6868", "localhost:6868")).toBe(true);
    expect(isWebSocketSameOrigin("https://clisbot.example.com", "clisbot.example.com")).toBe(true);
  });

  test("accepts loopback aliases on the same port", () => {
    expect(isWebSocketSameOrigin("http://127.0.0.1:32775", "localhost:32775")).toBe(true);
    expect(isWebSocketSameOrigin("http://localhost:32775", "127.0.0.1:32775")).toBe(true);
    expect(isWebSocketSameOrigin("http://[::1]:32775", "localhost:32775")).toBe(true);
    expect(isWebSocketSameOrigin("http://localhost:6868", "[::1]:6868")).toBe(true);
    expect(isWebSocketSameOrigin("http://127.0.0.1:6868", "localhost:6868")).toBe(true);
    expect(isWebSocketSameOrigin("http://LOCALHOST:6868", "localhost:6868")).toBe(true);
  });

  test("rejects loopback aliases on different ports", () => {
    expect(isWebSocketSameOrigin("http://127.0.0.1:32775", "localhost:6868")).toBe(false);
  });

  test("rejects *.localhost service-proxy origins against the daemon host (CB-02)", () => {
    expect(isWebSocketSameOrigin("http://dev--miniweb.localhost:6868", "localhost:6868")).toBe(
      false,
    );
    expect(isWebSocketSameOrigin("http://foo.localhost:6868", "localhost:6868")).toBe(false);
    expect(isWebSocketSameOrigin("http://foo.localhost:6868", "127.0.0.1:6868")).toBe(false);
    expect(isWebSocketSameOrigin("http://foo.localhost:6868", "[::1]:6868")).toBe(false);
    expect(isWebSocketSameOrigin("http://localhost:6868", "foo.localhost:6868")).toBe(false);
  });

  test("rejects *.localhost origins even when the Host header matches exactly (CB-02)", () => {
    expect(
      isWebSocketSameOrigin("http://dev--miniweb.localhost:6868", "dev--miniweb.localhost:6868"),
    ).toBe(false);
    expect(isWebSocketSameOrigin("https://foo.localhost", "foo.localhost")).toBe(false);
  });

  test("rejects hostnames that only look like loopback", () => {
    expect(isWebSocketSameOrigin("http://localhost.evil.example:6868", "localhost:6868")).toBe(
      false,
    );
    expect(isWebSocketSameOrigin("http://127.0.0.1.nip.io:6868", "localhost:6868")).toBe(false);
  });

  test("rejects non-loopback cross-origin upgrades", () => {
    expect(isWebSocketSameOrigin("http://evil.example:32775", "localhost:32775")).toBe(false);
    expect(isWebSocketSameOrigin("http://127.0.0.1:32775", "clisbot.example.com:32775")).toBe(
      false,
    );
  });
});
