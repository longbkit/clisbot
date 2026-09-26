// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useBotSidebarActions } from "./use-sidebar-actions";
const env = vi.hoisted(() => ({
  push: vi.fn(),
  createChat: vi.fn(),
  listChats: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: env.push }) }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ getClient: () => env }),
}));
vi.mock("../data/runtime", () => ({ refreshBotsAndChats: () => env.refresh() }));
beforeEach(() => {
  vi.clearAllMocks();
  env.listChats.mockResolvedValue({ chats: [], error: null });
});
it("coalesces rapid clicks before a render and does not create until own chats load", async () => {
  let finish!: (value: unknown) => void;
  env.createChat.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, rerender } = renderHook(
    ({ loaded }) => useBotSidebarActions([], undefined, loaded),
    { initialProps: { loaded: false } },
  );
  await act(async () => {
    await result.current.openBot("host", "bot");
  });
  expect(env.createChat).not.toHaveBeenCalled();
  rerender({ loaded: true });
  await act(async () => {
    const first = result.current.openBot("host", "bot");
    const second = result.current.openBot("host", "bot");
    await Promise.resolve();
    expect(env.createChat).toHaveBeenCalledTimes(1);
    finish({ chat: { id: "dm" }, error: null });
    await Promise.all([first, second]);
  });
  expect(env.push).toHaveBeenCalledTimes(1);
});
it("rechecks the authoritative private chat list before creating from a stale empty catalog", async () => {
  env.listChats.mockResolvedValue({
    chats: [{ id: "existing", kind: "direct", participants: [{ botId: "bot" }] }],
    error: null,
  });
  const { result } = renderHook(() => useBotSidebarActions([]));
  await act(async () => {
    await result.current.openBot("host", "bot");
  });
  expect(env.createChat).not.toHaveBeenCalled();
  expect(env.push).toHaveBeenCalledWith("/h/host/chat/existing");
});
