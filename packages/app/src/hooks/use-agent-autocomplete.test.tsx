// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useAgentAutocomplete } from "./use-agent-autocomplete";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-query", () => ({
  keepPreviousData: (data: unknown) => data,
  useQuery: () => ({ data: [], isLoading: false }),
}));
vi.mock("./use-agent-commands-query", () => ({
  useAgentCommandsQuery: () => ({ commands: [], isLoading: false, isError: false }),
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (select: (state: unknown) => unknown) =>
    select({ sessions: { host: { agents: new Map([["agent", { cwd: "/bot" }]]) } } }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => null,
  useHostRuntimeIsConnected: () => true,
}));
afterEach(cleanup);
test("unchanged mention text uses the newly selected source resolver", () => {
  const setUserInput = vi.fn();
  const { result, rerender } = renderHook(
    ({ root }: { root: string }) =>
      useAgentAutocomplete({
        userInput: "@src",
        cursorIndex: 4,
        setUserInput,
        serverId: "host",
        agentId: "agent",
        resolveWorkspaceFilePath: (path) => `${root}/${path}`,
      }),
    { initialProps: { root: "/alpha" } },
  );
  const option = { id: "file", label: "app.ts", type: "file", entryPath: "src/app.ts" };
  result.current.onSelectOption(option);
  expect(setUserInput).toHaveBeenLastCalledWith('"/alpha/src/app.ts"');
  rerender({ root: "/beta" });
  result.current.onSelectOption(option);
  expect(setUserInput).toHaveBeenLastCalledWith('"/beta/src/app.ts"');
});
