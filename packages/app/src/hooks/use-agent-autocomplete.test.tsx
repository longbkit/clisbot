// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  CLIENT_SLASH_COMMANDS,
  CONVERSATION_SLASH_COMMANDS,
  type ClientSlashCommand,
} from "@/client-slash-commands";
import { afterEach, expect, test, vi } from "vitest";
import { useAgentAutocomplete } from "./use-agent-autocomplete";
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
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

/** The same key handler the Chat and agent composers bind, with the slash list open on `text`. */
function renderSlash(input: {
  text: string;
  commands: readonly ClientSlashCommand[];
  onCommand?: (command: ClientSlashCommand) => boolean | void;
}) {
  const setUserInput = vi.fn();
  const onClientSlashCommand = vi.fn(input.onCommand ?? (() => true));
  const hook = renderHook(() =>
    useAgentAutocomplete({
      userInput: input.text,
      cursorIndex: input.text.length,
      setUserInput,
      serverId: "host",
      agentId: "agent",
      clientSlashCommands: input.commands,
      canExecuteClientSlashCommand: true,
      onClientSlashCommand,
    }),
  );
  const press = (key: string, extra: { shiftKey?: boolean } = {}) => {
    const preventDefault = vi.fn();
    let handled = false;
    act(() => {
      handled = hook.result.current.onKeyPress({
        key,
        ...extra,
        preventDefault,
        input: {
          text: input.text,
          selection: { start: input.text.length, end: input.text.length },
        },
      });
    });
    return { handled, prevented: preventDefault.mock.calls.length > 0 };
  };
  return { hook, press, setUserInput, onClientSlashCommand };
}

test("a Chat offers its own /new and never the agent tab's /clear or /exit", () => {
  const { hook } = renderSlash({ text: "/", commands: CONVERSATION_SLASH_COMMANDS });
  expect(hook.result.current.isVisible).toBe(true);
  expect(hook.result.current.options.map((option) => option.label)).toEqual(["/new"]);
});

test("Enter on an exact /new in a Chat runs the fresh-session command once", () => {
  const { press, onClientSlashCommand, setUserInput } = renderSlash({
    text: "/new",
    commands: CONVERSATION_SLASH_COMMANDS,
  });
  expect(press("Enter")).toEqual({ handled: true, prevented: true });
  expect(onClientSlashCommand).toHaveBeenCalledTimes(1);
  expect(onClientSlashCommand.mock.calls[0]?.[0]).toMatchObject({ kind: "fresh-chat-session" });
  expect(setUserInput).not.toHaveBeenCalled();
});

test("Tab on /ne completes /new and runs nothing", () => {
  const { press, onClientSlashCommand, setUserInput } = renderSlash({
    text: "/ne",
    commands: CONVERSATION_SLASH_COMMANDS,
  });
  expect(press("Tab")).toEqual({ handled: true, prevented: true });
  expect(onClientSlashCommand).not.toHaveBeenCalled();
  expect(setUserInput).toHaveBeenCalledWith("/new ");
});

test("Tab on an exact /new keeps the command text and runs nothing", () => {
  const { press, onClientSlashCommand, setUserInput } = renderSlash({
    text: "/new",
    commands: CONVERSATION_SLASH_COMMANDS,
  });
  press("Tab");
  expect(onClientSlashCommand).not.toHaveBeenCalled();
  expect(setUserInput).toHaveBeenCalledWith("/new ");
});

test("Tab never runs the agent tab's immediate /clear or /exit; Enter still does", () => {
  for (const text of ["/clear", "/exit", "/new"]) {
    const tab = renderSlash({ text, commands: CLIENT_SLASH_COMMANDS });
    tab.press("Tab");
    expect(tab.onClientSlashCommand).not.toHaveBeenCalled();
    expect(tab.setUserInput).toHaveBeenCalledTimes(1);
    cleanup();
  }
  const enter = renderSlash({ text: "/clear", commands: CLIENT_SLASH_COMMANDS });
  enter.press("Enter");
  expect(enter.onClientSlashCommand).toHaveBeenCalledTimes(1);
});

test("Shift+Tab is left to focus navigation", () => {
  const { press, onClientSlashCommand, setUserInput } = renderSlash({
    text: "/new",
    commands: CONVERSATION_SLASH_COMMANDS,
  });
  expect(press("Tab", { shiftKey: true })).toEqual({ handled: false, prevented: false });
  expect(onClientSlashCommand).not.toHaveBeenCalled();
  expect(setUserInput).not.toHaveBeenCalled();
});

test("arrows move the selection and never pick", () => {
  const { press, onClientSlashCommand, setUserInput } = renderSlash({
    text: "/",
    commands: CLIENT_SLASH_COMMANDS,
  });
  expect(press("ArrowDown").handled).toBe(true);
  expect(press("ArrowUp").handled).toBe(true);
  expect(onClientSlashCommand).not.toHaveBeenCalled();
  expect(setUserInput).not.toHaveBeenCalled();
});

test("Escape closes the list and keeps the text; a closed list leaves Tab and Enter alone", () => {
  const { hook, press, onClientSlashCommand, setUserInput } = renderSlash({
    text: "/new",
    commands: CONVERSATION_SLASH_COMMANDS,
  });
  expect(press("Escape")).toEqual({ handled: true, prevented: true });
  expect(hook.result.current.isVisible).toBe(false);
  expect(setUserInput).not.toHaveBeenCalled();
  // No focus trap: the second Tab moves focus, Enter submits the text as typed.
  expect(press("Tab")).toEqual({ handled: false, prevented: false });
  expect(press("Enter")).toEqual({ handled: false, prevented: false });
  expect(onClientSlashCommand).not.toHaveBeenCalled();
});

test("a command its composer does not run is inserted instead of swallowing Enter", () => {
  const { press, onClientSlashCommand, setUserInput } = renderSlash({
    text: "/new",
    commands: CONVERSATION_SLASH_COMMANDS,
    onCommand: () => false,
  });
  press("Enter");
  expect(onClientSlashCommand).toHaveBeenCalledTimes(1);
  expect(setUserInput).toHaveBeenCalledWith("/new ");
});
