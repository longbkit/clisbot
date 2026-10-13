import { describe, expect, it } from "vitest";
import { buildConnectBotToChannelRoute, CONNECT_BOT_PARAMS } from "@/clisbot/hub/navigation";
import { canOpenChannelSetup } from "./channel-setup-entry";

describe("channel setup entry", () => {
  it("remains available before Hub discovery, enrollment or admin sign-in", () => {
    expect(canOpenChannelSetup("server-mac")).toBe(true);
    expect(canOpenChannelSetup("")).toBe(false);
  });
  it("retains Bot and Host identity, including escaped values", () => {
    const route = buildConnectBotToChannelRoute("srv/1", "bot a&b");
    const query = new URLSearchParams(route.split("?")[1]);
    expect(query.get(CONNECT_BOT_PARAMS.bot)).toBe("bot a&b");
    expect(query.get(CONNECT_BOT_PARAMS.host)).toBe("srv/1");
  });
});
