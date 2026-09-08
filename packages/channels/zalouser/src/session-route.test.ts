// Fusion-owned test for the carried target parsers (D-ZU-007).
//
// Upstream's `session-route.test.ts` only exercises
// `resolveZalouserOutboundSessionRoute`, which is dropped with the OpenClaw
// session-key builder. The three parsers that survive are what the tool, the
// message actions and the directory read, so they are covered here instead.
import { describe, expect, it } from "vitest";
import {
  normalizeZalouserTarget,
  parseZalouserDirectoryGroupId,
  parseZalouserOutboundTarget,
} from "./session-route.js";

describe("normalizeZalouserTarget", () => {
  it("strips the channel prefixes and canonicalizes group/user forms", () => {
    expect(normalizeZalouserTarget("zalouser:group:123")).toBe("group:123");
    expect(normalizeZalouserTarget("zlu:g:123")).toBe("group:123");
    expect(normalizeZalouserTarget("ZALOUSER:dm:456")).toBe("user:456");
    expect(normalizeZalouserTarget("u:456")).toBe("user:456");
    expect(normalizeZalouserTarget("g-abc")).toBe("group:g-abc");
    expect(normalizeZalouserTarget("u-abc")).toBe("user:u-abc");
    expect(normalizeZalouserTarget("789")).toBe("789");
    expect(normalizeZalouserTarget("  ")).toBeUndefined();
  });
});

describe("parseZalouserOutboundTarget", () => {
  it("splits a canonical target into a thread id and a group flag", () => {
    expect(parseZalouserOutboundTarget("group:123")).toEqual({ threadId: "123", isGroup: true });
    expect(parseZalouserOutboundTarget("user:456")).toEqual({ threadId: "456", isGroup: false });
  });

  it("treats a bare id as a direct thread", () => {
    expect(parseZalouserOutboundTarget("789")).toEqual({ threadId: "789", isGroup: false });
  });

  it("refuses an empty target", () => {
    expect(() => parseZalouserOutboundTarget("   ")).toThrow(/target is required/i);
  });
});

describe("parseZalouserDirectoryGroupId", () => {
  it("returns the bare group id", () => {
    expect(parseZalouserDirectoryGroupId("zalouser:group:123")).toBe("123");
    expect(parseZalouserDirectoryGroupId("123")).toBe("123");
  });

  it("refuses a user target", () => {
    expect(() => parseZalouserDirectoryGroupId("user:456")).toThrow(/group target/i);
  });
});
