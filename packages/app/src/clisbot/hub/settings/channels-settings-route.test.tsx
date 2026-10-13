// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChannelsSettingsRoute } from "./channels-settings-route";

const env = vi.hoisted(() => ({
  params: {} as Record<string, string | undefined>,
  enabled: true,
  replace: vi.fn(),
  startProps: null as { startOnHost: string; onConnected(): void } | null,
  setParams: vi.fn(),
  props: [] as { connectBot: unknown; onConnectBotOpened?: () => void }[],
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ setParams: env.setParams, replace: env.replace }),
  useLocalSearchParams: () => env.params,
}));
vi.mock("../account-provider", () => ({ useHubAccount: () => ({ enabled: env.enabled }) }));
vi.mock("@/device-access/hub-settings", () => ({
  HubConnectionSettings: (props: { startOnHost: string; onConnected(): void }) => {
    env.startProps = props;
    return null;
  },
}));
vi.mock("./channel-settings", () => ({
  ChannelSettings: (props: { connectBot: unknown; onConnectBotOpened?: () => void }) => {
    env.props.push(props);
    return null;
  },
}));

beforeEach(() => {
  env.params = {};
  env.enabled = true;
  env.replace.mockReset();
  env.startProps = null;
  env.setParams.mockReset();
  env.props = [];
});
afterEach(cleanup);

it("starts Hub on the Bot's Host and retains the Bot destination after connecting", () => {
  env.enabled = false;
  env.params = { connectBot: "bot_luna", connectBotHost: "server-mac" };
  render(<ChannelsSettingsRoute />);
  expect(env.props).toEqual([]);
  expect(env.startProps?.startOnHost).toBe("server-mac");
  expect(env.setParams).not.toHaveBeenCalled();
  env.startProps?.onConnected();
  expect(env.replace).toHaveBeenCalledWith(
    "/settings/hub/channels?connectBot=bot_luna&connectBotHost=server-mac",
  );
});

it("opens Channels on the Bot the query names, and clears the query once it opened", () => {
  env.params = { connectBot: "bot_luna", connectBotHost: "server-mac" };
  render(<ChannelsSettingsRoute />);
  const props = env.props.at(-1)!;
  expect(props.connectBot).toEqual({ serverId: "server-mac", botId: "bot_luna" });
  props.onConnectBotOpened?.();
  expect(env.setParams).toHaveBeenCalledWith({ connectBot: undefined, connectBotHost: undefined });
});

it("asks for nothing without both the Bot and its Host", () => {
  env.params = { connectBot: "bot_luna" };
  render(<ChannelsSettingsRoute />);
  expect(env.props.at(-1)!.connectBot).toBeNull();
  cleanup();
  env.params = {};
  render(<ChannelsSettingsRoute />);
  expect(env.props.at(-1)!.connectBot).toBeNull();
});
