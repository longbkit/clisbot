import { describe, expect, it } from "vitest";
import { sessionStorageReadable } from "./capability";

describe("session storage read negotiation", () => {
  it("negotiates extended reads independently of capture", () => {
    expect(
      sessionStorageReadable({
        features: { agentSessionStorageRead: true, agentSessionStorage: false },
      }),
    ).toBe(true);
    expect(sessionStorageReadable({ features: { agentSessionStorage: true } })).toBe(false);
    expect(
      sessionStorageReadable({
        features: { agentSessionStorageRead: false, agentSessionStorage: true },
      }),
    ).toBe(false);
    expect(sessionStorageReadable({ features: { agentSessionStorage: false } })).toBe(false);
    expect(sessionStorageReadable(undefined)).toBe(false);
  });
});
