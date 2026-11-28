import React, { act, useMemo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCallDetail } from "@clisbot/protocol/agent-types";
import { createStreamPresentation } from "@/agent-stream/presentation";
import { ToastProvider } from "@/contexts/toast-context";
import {
  APP_SETTINGS_KEY,
  CHAT_DISPLAYS,
  useSettings,
  type ChatDisplay,
} from "@/hooks/use-settings";
import { i18n as testI18n } from "@/i18n/i18next";
import { ToolCallGroupView } from "@/tool-calls/detail-level/group-view";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import { ChatSection } from "./chat-section";

// Load translations so labels are the real ones the reader sees.
void testI18n;

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

const SETTINGS_MIGRATIONS_KEY = "@clisbot:settings-migrations";

function shell(id: string, command: string): ToolCallItem {
  const detail: ToolCallDetail = { type: "shell", command };
  return {
    kind: "tool_call",
    id,
    turnId: "turn-1",
    timestamp: new Date(`2026-01-01T00:00:0${id.slice(-1)}.000Z`),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: "Bash",
        status: "completed",
        error: null,
        detail,
      },
    },
  };
}

/** One finished turn: a prompt, three commands, a reply, and the next prompt that closes it. */
const TIMELINE: StreamItem[] = [
  {
    kind: "user_message",
    id: "prompt-1",
    turnId: "turn-1",
    text: "Check the build",
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
  },
  shell("call-1", "npm ci"),
  shell("call-2", "npm run build"),
  shell("call-3", "npm test"),
  {
    kind: "assistant_message",
    id: "reply-1",
    turnId: "turn-1",
    text: "All green",
    timestamp: new Date("2026-01-01T00:00:09.000Z"),
  },
  {
    kind: "user_message",
    id: "prompt-2",
    turnId: "turn-2",
    text: "Thanks",
    timestamp: new Date("2026-01-01T00:01:00.000Z"),
  },
];

const NO_EXPANDED_TURNS: ReadonlySet<string> = new Set();
const noop = () => {};

/**
 * The timeline as `AgentStreamView` builds it: the chat display setting picks the presentation,
 * and a grouped run renders through the same `ToolCallGroupView`. Ungrouped rows are reduced to a
 * marker naming their kind, which is all these tests read.
 */
/** A turn still running its one tool call, so no display folds the turn itself. */
const LONE_CALL_TIMELINE: StreamItem[] = [
  {
    kind: "user_message",
    id: "prompt-1",
    turnId: "turn-1",
    text: "Run the tests",
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
  },
  shell("call-1", "npm test"),
];

function Timeline({
  tail = TIMELINE,
  isTurnActive = false,
}: {
  tail?: StreamItem[];
  isTurnActive?: boolean;
}) {
  // The same setting AgentStreamView selects; isLoading only tells the test when it was read.
  const { settings, isLoading } = useSettings();
  const chatDisplay = settings.chatDisplay;
  const present = useMemo(() => createStreamPresentation(), []);
  const presentation = present({
    tail,
    head: [],
    transform: undefined,
    display: chatDisplay,
    expandedTurnHostIds: NO_EXPANDED_TURNS,
    isTurnActive,
  });
  const dataSet = useMemo(
    () => ({ display: chatDisplay, loaded: isLoading ? "no" : "yes" }),
    [chatDisplay, isLoading],
  );
  return (
    <View testID="timeline" dataSet={dataSet}>
      {presentation.tail.map((item) => {
        const group = presentation.groupsByHostId.get(item.id);
        if (group) {
          return (
            <ToolCallGroupView
              key={item.id}
              group={group}
              expanded={false}
              isLastInSequence
              onExpandedChange={noop}
            >
              {null}
            </ToolCallGroupView>
          );
        }
        return (
          <Text key={item.id} testID={`row-${item.kind}`}>
            {item.id}
          </Text>
        );
      })}
    </View>
  );
}

/** The labels of the open menu's items, in order. */
function menuItemLabels(): (string | undefined)[] {
  return [...document.querySelectorAll('[role="menuitem"]')].map((element) =>
    element.textContent?.trim(),
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** A fresh app session: a new query cache reads settings back from persisted storage. */
async function mountApp(children: ReactNode): Promise<void> {
  unmountApp();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const queryClient = new QueryClient();
  const mountedRoot = root;
  await act(async () => {
    mountedRoot.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>,
    );
  });
  // Until persisted settings are read the hook reports defaults; wait for the stored choice.
  await vi.waitFor(() => expect(timeline().dataset.loaded).toBe("yes"));
}

function unmountApp(): void {
  const mountedRoot = root;
  if (mountedRoot) act(() => mountedRoot.unmount());
  container?.remove();
  root = null;
  container = null;
}

afterEach(async () => {
  unmountApp();
  await AsyncStorage.clear();
});

function timeline(): HTMLElement {
  const element = document.querySelector('[data-testid="timeline"]');
  if (!(element instanceof HTMLElement)) throw new Error("timeline did not render");
  return element;
}

function count(selector: string): number {
  return timeline().querySelectorAll(selector).length;
}

function groupText(): string {
  return timeline().querySelector('[data-testid="tool-call-group"]')?.textContent ?? "";
}

/** What the reader sees in the timeline for the finished turn. */
function renderedShape() {
  return {
    display: timeline().dataset.display,
    singleCalls: count('[data-testid="row-tool_call"]'),
    groups: count('[data-testid="tool-call-group"]'),
    turnSummaries: count('[data-testid="row-turn_summary"]'),
    replies: count('[data-testid="row-assistant_message"]'),
  };
}

/** What each display folds the finished turn into: single rows, a group's label, or a turn row. */
const EXPECTED_SHAPE: Record<
  ChatDisplay,
  { singleCalls: number; groups: number; turnSummaries: number; groupLabel?: string }
> = {
  full: { singleCalls: 3, groups: 0, turnSummaries: 0 },
  collapseToolCalls: { singleCalls: 0, groups: 1, turnSummaries: 0, groupLabel: "Ran 3 commands" },
  "summary-with-latest-call": {
    singleCalls: 0,
    groups: 1,
    turnSummaries: 0,
    groupLabel: "3 tool calls",
  },
  collapseTurns: { singleCalls: 0, groups: 0, turnSummaries: 1 },
};

function expectTimelineFor(display: ChatDisplay): void {
  const { groupLabel, ...rows } = EXPECTED_SHAPE[display];
  expect(renderedShape()).toMatchObject({ display, ...rows });
  if (groupLabel) expect(groupText()).toContain(groupLabel);
}

async function persistDisplay(chatDisplay: ChatDisplay): Promise<void> {
  // An install that already ran the one-time latest-call reset, so the stored choice stands.
  await AsyncStorage.setItem(
    SETTINGS_MIGRATIONS_KEY,
    JSON.stringify({
      applied: ["steer-default", "mobile-content-16", "summary-with-latest-call-default"],
    }),
  );
  await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify({ chatDisplay }));
}

describe("the timeline follows the chat display setting", () => {
  it("shows every tool call on its own row for full", async () => {
    await persistDisplay("full");
    await mountApp(<Timeline />);
    expect(renderedShape()).toEqual({
      display: "full",
      singleCalls: 3,
      groups: 0,
      turnSummaries: 0,
      replies: 1,
    });
  });

  it("folds the run into an overview summary for collapse tool calls", async () => {
    await persistDisplay("collapseToolCalls");
    await mountApp(<Timeline />);
    expect(renderedShape()).toEqual({
      display: "collapseToolCalls",
      singleCalls: 0,
      groups: 1,
      turnSummaries: 0,
      replies: 1,
    });
    expect(groupText()).toContain("Ran 3 commands");
  });

  it("folds the run into a count with the latest call for Clisbot's latest-call display", async () => {
    await persistDisplay("summary-with-latest-call");
    await mountApp(<Timeline />);
    expect(renderedShape()).toEqual({
      display: "summary-with-latest-call",
      singleCalls: 0,
      groups: 1,
      turnSummaries: 0,
      replies: 1,
    });
    expect(groupText()).toContain("3 tool calls");
    expect(groupText()).toContain("npm test");
    expect(groupText()).not.toContain("Ran 3 commands");
  });

  it("folds the finished turn into a summary row for collapse turns", async () => {
    await persistDisplay("collapseTurns");
    await mountApp(<Timeline />);
    expect(renderedShape()).toMatchObject({
      display: "collapseTurns",
      singleCalls: 0,
      groups: 0,
      turnSummaries: 1,
    });
  });

  it("covers every option the setting offers", () => {
    expect([...CHAT_DISPLAYS].sort()).toEqual(
      ["collapseToolCalls", "collapseTurns", "full", "summary-with-latest-call"].sort(),
    );
  });
});

function chatDisplayTrigger(): HTMLElement {
  const trigger = [...document.querySelectorAll('[role="button"]')].find((element) =>
    element.getAttribute("aria-label")?.startsWith("Chat display:"),
  );
  if (!(trigger instanceof HTMLElement)) throw new Error("chat display setting did not render");
  return trigger;
}

async function chooseChatDisplay(label: string): Promise<void> {
  await act(async () => chatDisplayTrigger().click());
  const option = await vi.waitFor(() => {
    const match = [...document.querySelectorAll('[role="menuitem"]')].find(
      (element) => element.textContent?.trim() === label,
    );
    if (!(match instanceof HTMLElement)) throw new Error(`no ${label} option`);
    return match;
  });
  await act(async () => option.click());
}

function SettingsAndTimeline(props: { tail?: StreamItem[]; isTurnActive?: boolean }) {
  return (
    <>
      <ChatSection />
      <Timeline {...props} />
    </>
  );
}

function LoneCallTimeline() {
  return <Timeline tail={LONE_CALL_TIMELINE} isTurnActive />;
}

function SettingsAndLoneCall() {
  return <SettingsAndTimeline tail={LONE_CALL_TIMELINE} isTurnActive />;
}

/** Clisbot's latest-call badge for one call; upstream keeps the call's own row elsewhere. */
function expectLoneCallFor(display: ChatDisplay): void {
  const { display: shown, singleCalls, groups } = renderedShape();
  expect(shown).toBe(display);
  if (display === "summary-with-latest-call") {
    expect({ singleCalls, groups }).toEqual({ singleCalls: 0, groups: 1 });
    expect(groupText()).toContain("1 tool call");
    expect(groupText()).toContain("npm test");
  } else {
    expect({ singleCalls, groups }).toEqual({ singleCalls: 1, groups: 0 });
  }
}

describe("a lone tool call follows the chat display setting", () => {
  it.each(CHAT_DISPLAYS)("renders as the %s display designs it", async (display) => {
    await persistDisplay(display);
    await mountApp(<LoneCallTimeline />);
    expectLoneCallFor(display);
  });

  it.each([
    ["Summary with latest call", "summary-with-latest-call", "full"],
    ["Collapse tool calls", "collapseToolCalls", "summary-with-latest-call"],
    ["Full", "full", "summary-with-latest-call"],
    ["Collapse turns", "collapseTurns", "summary-with-latest-call"],
  ] as const)(
    "selecting %s switches the lone call's presentation and survives a reload",
    async (label, value, from) => {
      await persistDisplay(from);
      await mountApp(<SettingsAndLoneCall />);
      expectLoneCallFor(from);

      await chooseChatDisplay(label);
      await vi.waitFor(() => expect(timeline().dataset.display).toBe(value));
      expectLoneCallFor(value);
      const stored = JSON.parse((await AsyncStorage.getItem(APP_SETTINGS_KEY)) ?? "null");
      expect(stored.chatDisplay).toBe(value);

      await mountApp(<SettingsAndLoneCall />);
      expectLoneCallFor(value);
      expect(chatDisplayTrigger().getAttribute("aria-label")).toBe(`Chat display: ${label}`);
    },
  );
});

describe("chat display: settings, render, reload", () => {
  it("offers each display once, with Clisbot's latest call beside upstream's choices", async () => {
    await persistDisplay("full");
    await mountApp(<SettingsAndTimeline />);
    await act(async () => chatDisplayTrigger().click());
    const labels = await vi.waitFor(() => {
      const items = menuItemLabels();
      expect(items.length).toBeGreaterThan(0);
      return items;
    });
    expect(labels).toEqual([
      "Full",
      "Collapse tool calls",
      "Summary with latest call",
      "Collapse turns",
    ]);
    // One setting row: the legacy detail level no longer renders a second one.
    expect(
      [...document.querySelectorAll('[role="button"]')].filter((element) =>
        /^(Chat display|Tool call detail)/.test(element.getAttribute("aria-label") ?? ""),
      ),
    ).toHaveLength(1);
  });

  it.each([
    ["Summary with latest call", "summary-with-latest-call"],
    ["Collapse tool calls", "collapseToolCalls"],
    ["Collapse turns", "collapseTurns"],
    ["Full", "full"],
  ] as const)("selecting %s updates the timeline and survives a reload", async (label, value) => {
    // Start from a different display so the change is observable.
    await persistDisplay(value === "full" ? "collapseTurns" : "full");
    await mountApp(<SettingsAndTimeline />);
    const before = renderedShape();

    await chooseChatDisplay(label);
    await vi.waitFor(() => expect(timeline().dataset.display).toBe(value));
    const after = renderedShape();
    expect(after).not.toEqual(before);
    expectTimelineFor(value);
    expect(chatDisplayTrigger().getAttribute("aria-label")).toBe(`Chat display: ${label}`);
    const stored = JSON.parse((await AsyncStorage.getItem(APP_SETTINGS_KEY)) ?? "null");
    expect(stored.chatDisplay).toBe(value);

    // Reload: a new app session reads the persisted setting and renders the same timeline.
    await mountApp(<SettingsAndTimeline />);
    expect(timeline().dataset.display).toBe(value);
    expect(renderedShape()).toEqual(after);
    expectTimelineFor(value);
    expect(chatDisplayTrigger().getAttribute("aria-label")).toBe(`Chat display: ${label}`);
  });
});
