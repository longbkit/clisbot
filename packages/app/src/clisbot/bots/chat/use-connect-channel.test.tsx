// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildConnectBotToChannelRoute, CONNECT_BOT_PARAMS } from "@/clisbot/hub/navigation";
import { useCanConnectBotToChannel, useOpenConnectBotToChannel } from "./use-connect-channel";

const env = vi.hoisted(() => ({
  enabled: true,
  manageResources: true,
  daemons: [{ id: "daemon-mac", connectionOffer: { serverId: "server-mac" } }] as
    | { id: string; connectionOffer: { serverId: string } | null }[]
    | undefined,
  push: vi.fn(),
}));
vi.mock("@/clisbot/hub/account-provider", () => ({
  useHubAccount: () => ({
    enabled: env.enabled,
    signedIn: { capabilities: { manageResources: env.manageResources } },
  }),
}));
vi.mock("@/clisbot/hub/host-inventory", () => ({
  useHubDaemonsQuery: () => ({
    data: env.daemons === undefined ? undefined : { daemons: env.daemons },
  }),
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: env.push }) }));

beforeEach(() => {
  env.enabled = true;
  env.manageResources = true;
  env.daemons = [{ id: "daemon-mac", connectionOffer: { serverId: "server-mac" } }];
  env.push.mockReset();
});

describe("useCanConnectBotToChannel", () => {
  const can = (serverId: string) =>
    renderHook(() => useCanConnectBotToChannel()).result.current(serverId);

  it("lets an Organization Admin connect a Bot on a Host the Hub has enrolled", () => {
    expect(can("server-mac")).toBe(true);
  });

  it("refuses a Host the Hub does not know, or before the Hub's Hosts load", () => {
    expect(can("server-laptop")).toBe(false);
    env.daemons = [{ id: "daemon-pending", connectionOffer: null }];
    expect(can("server-mac")).toBe(false);
    env.daemons = undefined;
    expect(can("server-mac")).toBe(false);
  });

  it("refuses without a Hub or without the authority to pick a Route's target", () => {
    env.manageResources = false;
    expect(can("server-mac")).toBe(false);
    env.manageResources = true;
    env.enabled = false;
    expect(can("server-mac")).toBe(false);
  });
});

describe("useOpenConnectBotToChannel", () => {
  it("opens Channels with the Bot and its Host in the query", () => {
    const { result } = renderHook(() => useOpenConnectBotToChannel());
    result.current("server-mac", "bot_luna");
    expect(env.push).toHaveBeenCalledWith(
      "/settings/hub/channels?connectBot=bot_luna&connectBotHost=server-mac",
    );
  });

  it("encodes ids in the query", () => {
    const route = buildConnectBotToChannelRoute("srv/1", "bot a&b");
    const query = new URLSearchParams(route.split("?")[1]);
    expect(query.get(CONNECT_BOT_PARAMS.bot)).toBe("bot a&b");
    expect(query.get(CONNECT_BOT_PARAMS.host)).toBe("srv/1");
  });
});
