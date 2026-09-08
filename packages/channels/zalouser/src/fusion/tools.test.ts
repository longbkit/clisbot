// The `zalouser` agent tool's registration path (D-ZU-017) and its executor.
// The tool body itself is the ported `tool.ts`, covered by the ported
// `tool.test.ts`; what is asserted here is that the Fusion registrar hands the
// Hub a per-execution factory whose tool has upstream's name and schema.

import { describe, expect, it, vi } from "vitest";

vi.mock("../send.js", () => ({
  sendMessageZalouser: vi.fn(async () => ({ ok: true, messageId: "sent-1" })),
  sendImageZalouser: vi.fn(),
  sendLinkZalouser: vi.fn(),
}));
vi.mock("../zalo-js.js", () => ({
  checkZaloAuthenticated: vi.fn(async () => true),
  getZaloUserInfo: vi.fn(),
  listZaloFriendsMatching: vi.fn(),
  listZaloGroupsMatching: vi.fn(),
}));

import { sendMessageZalouser } from "../send.js";
import type { AnyAgentTool, OpenClawPluginToolFactory } from "../runtime-api.js";
import {
  collectZalouserToolRegistrations,
  registerZalouserTools,
  ZALOUSER_TOOL_NAMES,
  zalouserAgentTools,
} from "./tools.js";

describe("registerZalouserTools", () => {
  it("forwards every registration to the Fusion registrar", () => {
    const registerTool = vi.fn();
    const registrations = registerZalouserTools({ registerTool });

    expect(registrations).toHaveLength(zalouserAgentTools.length);
    expect(registerTool).toHaveBeenCalledTimes(zalouserAgentTools.length);
  });

  it("registers a per-execution factory, not a cached tool", () => {
    const [registration] = collectZalouserToolRegistrations();
    expect(typeof registration?.tool).toBe("function");
  });

  it("builds upstream's tool name and action enum", () => {
    const factory = collectZalouserToolRegistrations()[0]?.tool as OpenClawPluginToolFactory;
    const tool = factory({}) as AnyAgentTool;

    expect(tool.name).toBe("zalouser");
    expect([...ZALOUSER_TOOL_NAMES]).toEqual(["zalouser"]);
    const parameters = tool.parameters as { properties: { action: { enum: string[] } } };
    expect(parameters.properties.action.enum).toEqual([
      "send",
      "image",
      "link",
      "friends",
      "groups",
      "me",
      "status",
    ]);
  });

  it("executes a send through the ported send path with the bound delivery context", async () => {
    const factory = collectZalouserToolRegistrations()[0]?.tool as OpenClawPluginToolFactory;
    const tool = factory({
      deliveryContext: { channel: "zalouser", to: "zalouser:group:g1" },
    } as never) as AnyAgentTool;

    const result = await tool.execute("call-1", { action: "send", message: "hi" }, undefined, undefined);

    expect(sendMessageZalouser).toHaveBeenCalledWith(
      "g1",
      "hi",
      expect.objectContaining({ isGroup: true }),
    );
    expect(JSON.stringify(result)).toContain("sent-1");
  });
});
