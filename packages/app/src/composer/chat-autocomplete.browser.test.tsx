import React, { act, createRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PortalProvider } from "@gorhom/portal";
import { View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { createStore } from "zustand/vanilla";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CONVERSATION_SLASH_COMMANDS, type ClientSlashCommand } from "@/client-slash-commands";
import { RetainedPanel } from "@/components/retained-panel";
import { FloatingPanelPortalHost } from "@/components/ui/floating-panel-portal";
import { i18n } from "@/i18n/i18next";
import { KeyboardShiftProvider } from "@/keyboard/shift";
import { ComposerAutocompleteBinding, type ComposerAutocompleteHandle } from "@/composer";
import { ComposerKeyboardScopeProvider } from "@/composer/keyboard-scope";
import { ComposerRecall } from "@/composer/recall";
import type { MessageInputRef } from "@/composer/input/input";

/**
 * Live acceptance (v0.17.4 merge): a Chat with a session and loaded provider commands showed no
 * list at all on a bare `/`. The hook listed `/new` and the provider's rows with nothing selected,
 * but the popover waited for a selection before it measured, so it never opened. This mounts the
 * composer's own autocomplete binding and popover as a Chat composes them.
 */

// The provider's commands for the Chat's session agent, already loaded. One stable result, as
// React Query hands back between renders.
const loaded = vi.hoisted(() => ({
  commands: {
    commands: [
      { name: "review", description: "Review the current changes", argumentHint: "" },
      { name: "compact", description: "Compact the conversation", argumentHint: "" },
    ],
    isLoading: false,
    isError: false,
    error: null,
    retry: () => undefined,
  },
}));
// A factory without importOriginal: in browser mode the original module's import cycle through
// `@/agent-commands` stalls the mock resolution.
vi.mock("@/agent-commands/use-query", () => ({
  fetchAgentCommands: async () => [],
  useAgentCommandsQuery: () => loaded.commands,
}));

beforeEach(() => vi.stubGlobal("React", React));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const SAFE_AREA = {
  frame: { x: 0, y: 0, width: 1024, height: 768 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const SCREEN = { width: 1024, height: 768 };
const DOCK = { position: "absolute" as const, bottom: 24, left: 16, width: 720 };
const INPUT = { height: 48 };

function textSource(value: string) {
  return { getSnapshot: () => value, subscribe: () => () => undefined };
}

function ChatTestProviders({ children }: { children: ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient());
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider initialMetrics={SAFE_AREA}>
          <KeyboardProvider>
            <KeyboardShiftProvider>
              <PortalProvider>{children}</PortalProvider>
            </KeyboardShiftProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

function ComposerTestScope({ children }: { children: ReactNode }) {
  return (
    <RetainedPanel active>
      <ComposerKeyboardScopeProvider isPaneFocused isActiveComposer isCommandCenterTarget>
        {children}
      </ComposerKeyboardScopeProvider>
    </RetainedPanel>
  );
}

function ChatAutocomplete(props: {
  text: string;
  handle: React.RefObject<ComposerAutocompleteHandle | null>;
  run: (command: ClientSlashCommand) => void;
  setUserInput: (text: string) => void;
}): ReactNode {
  const [cursor] = React.useState(() => createStore(() => props.text.length));
  const [recall] = React.useState(() => new ComposerRecall());
  const [text] = React.useState(() => textSource(props.text));
  const inputRef = React.useRef<MessageInputRef | null>(null);
  // Stable, as the composer memoizes it: a new object each render re-derives the menu.
  const { run, setUserInput } = props;
  const configuration = React.useMemo(
    () => ({
      setUserInput,
      serverId: "host",
      // The Chat's session agent, which has provider commands.
      agentId: "session-agent",
      canExecuteClientSlashCommand: true,
      onClientSlashCommand: run,
      clientSlashCommands: CONVERSATION_SLASH_COMMANDS,
      listClientCommandsOnBareSlash: true,
      providerCommandsAvailable: true,
    }),
    [run, setUserInput],
  );
  return (
    <ChatTestProviders>
      <ComposerTestScope>
        <View style={SCREEN}>
          <View style={DOCK}>
            <ComposerAutocompleteBinding
              text={text}
              cursor={cursor}
              recall={recall}
              inputRef={inputRef}
              anchorStyle={undefined}
              show
              ref={props.handle}
              configuration={configuration}
            >
              <View testID="composer-input" style={INPUT} />
            </ComposerAutocompleteBinding>
          </View>
          <FloatingPanelPortalHost />
        </View>
      </ComposerTestScope>
    </ChatTestProviders>
  );
}

function mount(text: string) {
  const handle = createRef<ComposerAutocompleteHandle>();
  const run = vi.fn();
  const setUserInput = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <ChatAutocomplete text={text} handle={handle} run={run} setUserInput={setUserInput} />,
    ),
  );
  const press = (key: string) => {
    let handled = false;
    act(() => {
      handled =
        handle.current?.onKeyPress({
          key,
          hasModifier: false,
          preventDefault: () => undefined,
          input: { text, selection: { start: text.length, end: text.length } },
        }) ?? false;
    });
    return handled;
  };
  return { run, setUserInput, press };
}

async function popoverCommands(): Promise<string[]> {
  await expect
    .poll(() => document.querySelector('[data-testid="composer-autocomplete-popover"]'))
    .not.toBeNull();
  return [...document.querySelectorAll('[data-testid="composer-command-name"]')].map(
    (node) => node.textContent ?? "",
  );
}

function selectedRows(): Element[] {
  return [
    ...document.querySelectorAll(
      '[data-testid="composer-autocomplete-popover"] [aria-selected="true"]',
    ),
  ];
}

it("opens the list on a Chat's bare / with /new and the provider's rows, nothing selected", async () => {
  mount("/");
  const commands = await popoverCommands();
  expect(commands).toEqual(expect.arrayContaining(["/new", "/review", "/compact"]));
  expect(selectedRows()).toEqual([]);
});

it("Enter and Tab on the bare / list pick and run nothing", async () => {
  const { press, run, setUserInput } = mount("/");
  await popoverCommands();
  press("Enter");
  press("Tab");
  expect(run).not.toHaveBeenCalled();
  expect(setUserInput).not.toHaveBeenCalled();
});

it("an arrow key selects a row; Enter then runs /new once", async () => {
  const { press, run } = mount("/");
  await popoverCommands();
  // The list opens above the composer: ArrowUp reaches the far end, ArrowDown the first row.
  for (let step = 0; step < 4 && run.mock.calls.length === 0; step += 1) {
    press("ArrowDown");
    expect(selectedRows()).toHaveLength(1);
    const selected = selectedRows()[0]?.getAttribute("aria-label") ?? "";
    if (selected.startsWith("/new")) press("Enter");
  }
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]?.[0]).toMatchObject({ kind: "fresh-chat-session" });
});

it("exact /new: the list opens with it selected, Enter runs it once, Tab only completes", async () => {
  const enter = mount("/new");
  const commands = await popoverCommands();
  expect(commands).toContain("/new");
  expect(selectedRows()).toHaveLength(1);
  enter.press("Enter");
  expect(enter.run).toHaveBeenCalledTimes(1);
  act(() => root?.unmount());
  container?.remove();

  const tab = mount("/new");
  await popoverCommands();
  tab.press("Tab");
  expect(tab.run).not.toHaveBeenCalled();
  expect(tab.setUserInput).toHaveBeenCalledWith("/new ");
});
