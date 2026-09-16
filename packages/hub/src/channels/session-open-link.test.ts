import { describe, expect, it } from "vitest";
import { sessionDeepLink, sessionOpenRedirect, sessionOpenUrl } from "./session-open-link.js";

describe("session open link", () => {
  it("builds an https hand-off that names the Host", () => {
    expect(sessionOpenUrl("https://hub.test/", "srv_1", "agent-1")).toBe(
      "https://hub.test/api/open/agent/agent-1?host=srv_1",
    );
    expect(sessionDeepLink("srv_1", "agent-1")).toBe("paseo://h/srv_1/agent/agent-1");
  });
  it("redirects into the scheme only for ids the daemon could have issued", () => {
    expect(sessionOpenRedirect("agent-1", "srv_1")).toBe("paseo://h/srv_1/agent/agent-1");
    expect(sessionOpenRedirect("agent-1", null)).toBeUndefined();
    expect(sessionOpenRedirect("agent-1", "")).toBeUndefined();
    expect(sessionOpenRedirect("agent-1", "srv\r\nLocation: https://evil.test")).toBeUndefined();
    expect(sessionOpenRedirect("../../evil", "srv_1")).toBeUndefined();
    expect(sessionOpenRedirect("agent-1", "javascript:alert(1)")).toBeUndefined();
  });
});
