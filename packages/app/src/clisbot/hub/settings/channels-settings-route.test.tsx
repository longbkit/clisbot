// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChannelsSettingsRoute } from "./channels-settings-route";

const env = vi.hoisted(() => ({
  params: {} as Record<string, string | undefined>,
  setParams: vi.fn(),
  props: [] as { connectBot: unknown; onConnectBotOpened?: () => void }[],
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ setParams: env.setParams }),
  useLocalSearchParams: () => env.params,
}));
vi.mock("./channel-settings", () => ({
  ChannelSettings: (props: { connectBot: unknown; onConnectBotOpened?: () => void }) => {
    env.props.push(props);
    return null;
  },
}));

beforeEach(() => {
  env.params = {};
  env.setParams.mockReset();
  env.props = [];
});
afterEach(cleanup);

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
