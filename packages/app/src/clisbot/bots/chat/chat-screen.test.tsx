vi.mock("./use-chat-message-images", () => ({ useChatMessageImages: () => [] }));
vi.mock("@/components/retained-panel", () => ({ useRetainedPanelActive: () => true }));
import { useToolCallSheet } from "@/components/tool-call-sheet";
import { useAssistantFileLinkResolverContext } from "@/assistant-file-links/provider";
// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingPermission } from "@/types/shared";
import type { StreamItem } from "@/types/stream";
import type { ChatMessage } from "../data/contracts";
import { ChatScreen } from "./chat-screen";
import type { ChatLiveHead } from "./render-model";

vi.mock("@/components/ui/isolated-bottom-sheet-modal", () => ({
  IsolatedBottomSheetModal: () => null,
  useIsolatedBottomSheetVisibility: () => ({
    sheetRef: { current: null },
    handleSheetChange: vi.fn(),
    handleSheetDismiss: vi.fn(),
  }),
}));
vi.mock("@gorhom/bottom-sheet", () => ({
  BottomSheetScrollView: () => null,
  BottomSheetBackdrop: () => null,
}));
vi.mock("@/components/tool-call-details", () => ({ ToolCallDetailsContent: () => null }));
vi.mock("@/stores/navigation-active-workspace-store", () => ({ navigateToWorkspace: vi.fn() }));
vi.mock("@/agent-stream/turn-footer", () => ({
  RunningTurnFooter: ({ inFlightTurnStartedAt }: { inFlightTurnStartedAt: Date | null }) => (
    <div
      data-testid="turn-working-indicator"
      data-started-at={inFlightTurnStartedAt?.toISOString()}
    />
  ),
}));
vi.mock("@/agent-stream/view", () => ({
  PermissionRequestCard: ({
    permission,
    serverId,
  }: {
    permission: PendingPermission;
    serverId: string;
  }) => (
    <div
      data-testid="permission-card"
      data-agent={permission.agentId}
      data-server={serverId}
      data-kind={permission.request.kind}
    />
  ),
}));
vi.mock("@/runtime/host-runtime", () => ({ useHostRuntimeClient: () => null }));
vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Platform: { OS: "web" },
  View: ({ children, testID }: { children?: ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  Text: ({ children, testID }: { children?: ReactNode; testID?: string }) => (
    <span data-testid={testID}>{children}</span>
  ),
  FlatList: ({
    data,
    renderItem,
    keyExtractor,
  }: {
    data: unknown[];
    renderItem: (info: { item: unknown; index: number }) => ReactNode;
    keyExtractor: (item: unknown) => string;
  }) => (
    <ol data-testid="chat-list">
      {data.map((item, index) => (
        <li key={keyExtractor(item)}>{renderItem({ item, index })}</li>
      ))}
    </ol>
  ),
}));
vi.mock("@/components/headers/menu-header", () => ({
  MenuHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/clisbot/session-storage/actor-row", () => ({
  ActorResponseRow: ({
    name,
    opensGroup,
    children,
  }: {
    name?: string | null;
    opensGroup?: boolean;
    children: ReactNode;
  }) => (
    <section data-sender={opensGroup ? name : undefined}>
      {opensGroup ? <strong>{name}</strong> : null}
      {children}
    </section>
  ),
}));
vi.mock("@/components/message", () => ({
  UserMessage: ({ message, isFirstInGroup }: { message: string; isFirstInGroup: boolean }) => (
    <p data-kind="user" data-first={String(isFirstInGroup)}>
      {message}
    </p>
  ),
  AssistantMessage: ({ message, phase }: { message: string; phase: string }) => {
    useAssistantFileLinkResolverContext();
    return (
      <p data-kind="assistant" data-phase={phase}>
        {message}
      </p>
    );
  },
  ToolCall: ({ toolName, status }: { toolName: string; status: string }) => {
    useToolCallSheet();
    return (
      <p data-kind="tool" data-status={status}>
        {toolName}
      </p>
    );
  },
  Notification: ({ message }: { message: string }) => <p data-kind="notice">{message}</p>,
}));
vi.mock("@/components/question-form-card", () => ({ QuestionFormCard: () => <form /> }));
vi.mock("./bot-face", () => ({ BotFace: ({ name }: { name: string }) => <b>{name.charAt(0)}</b> }));
// The mocked composer sends a fixed text through whatever submit handler it was last given.
const composerProps: { onSubmitMessage?: (text: string) => Promise<void> } = {};
function sendHello() {
  void composerProps.onSubmitMessage?.("hello");
}
vi.mock("./chat-composer", () => ({
  ChatComposer: (props: {
    placeholder: string;
    disabled: boolean;
    onSubmitMessage: (text: string) => Promise<void>;
  }) => {
    Object.assign(composerProps, props);
    return (
      <button type="button" disabled={props.disabled} onClick={sendHello}>
        {props.placeholder}
      </button>
    );
  },
}));

let seq = 0;
function line(
  sender: ChatMessage["sender"],
  text: string,
  ref?: { agentId: string; itemId: string },
): ChatMessage {
  seq += 1;
  return {
    id: `line-${seq}`,
    seq,
    at: new Date(seq * 1000).toISOString(),
    sender,
    text,
    ...(ref ? { agentId: ref.agentId, timelineItemId: ref.itemId } : {}),
  };
}

const BOTS = [
  { botId: "research", name: "Research" },
  { botId: "writer", name: "Writer" },
];

function toolItem(id: string, at: number): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(at),
    payload: {
      source: "agent",
      data: {
        provider: "mock",
        callId: id,
        name: "search",
        status: "running",
        error: undefined,
        detail: { type: "unknown", input: null, output: null },
      },
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  seq = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatScreen", () => {
  it("renders a group chat: sender names open groups, the live head streams", () => {
    const transcript = [
      line({ kind: "user" }, "Plan the launch"),
      line({ kind: "bot", botId: "research" }, "Here is what I found", {
        agentId: "agent-r",
        itemId: "r-1",
      }),
      line({ kind: "bot", botId: "research" }, "And one more thing", {
        agentId: "agent-r",
        itemId: "r-2",
      }),
      line({ kind: "bot", botId: "writer" }, "Drafting now", { agentId: "agent-w", itemId: "w-1" }),
      line({ kind: "user" }, "Thanks"),
    ];
    const liveHeads = new Map<string, ChatLiveHead>([
      [
        "writer",
        {
          agentId: "agent-w",
          turnActive: true,
          permissions: [],
          startedAt: new Date("2026-09-28T00:00:00Z"),
          items: [
            toolItem("w-tool", 9000),
            { kind: "assistant_message", id: "w-2", text: "Working on", timestamp: new Date(9500) },
          ],
        },
      ],
    ]);
    render(
      <ChatScreen
        serverId="host-a"
        chatId="chat-1"
        title="Research, Writer"
        bots={BOTS}
        transcript={transcript}
        liveHeads={liveHeads}
        onSubmitMessage={vi.fn(async () => {})}
      />,
    );
    expect(screen.getByRole("heading", { name: "Research, Writer" })).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    // Inverted list: the newest row renders first.
    const order = items.map((item) => item.textContent);
    expect(order[0]).toContain("Working on");
    expect(screen.getByTestId("turn-working-indicator").getAttribute("data-started-at")).toBe(
      "2026-09-28T00:00:00.000Z",
    );
    expect(order[order.length - 1]).toBe("Plan the launch");
    expect(screen.getAllByText("Research")).toHaveLength(1);
    expect(screen.getAllByText("Writer")).toHaveLength(2);
    expect(screen.getByText("Working on").getAttribute("data-phase")).toBe("streaming");
    expect(screen.getByText("search").getAttribute("data-status")).toBe("running");
    expect(screen.getByText("Here is what I found").getAttribute("data-phase")).toBe("complete");
    expect(screen.getByText("Thanks").getAttribute("data-first")).toBe("true");
  });

  it("names the bot in a direct chat and hands the text to the submit handler", () => {
    const onSubmitMessage = vi.fn(async () => {});
    render(
      <ChatScreen
        serverId="host-a"
        chatId="chat-2"
        title="Research"
        bots={[BOTS[0]!]}
        transcript={[]}
        liveHeads={new Map()}
        onSubmitMessage={onSubmitMessage}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Message Research" }));
    expect(onSubmitMessage).toHaveBeenCalledWith("hello");
  });

  it("disables sending while the host cannot send", () => {
    render(
      <ChatScreen
        serverId="host-a"
        chatId="chat-3"
        title="Group"
        bots={BOTS}
        transcript={[]}
        liveHeads={new Map()}
        canSend={false}
        onSubmitMessage={vi.fn(async () => {})}
      />,
    );
    expect((screen.getByRole("button", { name: "Message" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

it("routes question permissions through the shared receipt-aware, pending-state card", () => {
  const liveHeads = new Map<string, ChatLiveHead>([
    [
      "research",
      {
        agentId: "agent-r",
        turnActive: true,
        items: [],
        permissions: [
          {
            key: "q",
            agentId: "agent-r",
            request: {
              id: "q",
              provider: "codex",
              name: "AskUserQuestion",
              kind: "question",
              input: { questions: [{ question: "Ship?", options: [{ label: "Yes" }] }] },
            },
          },
        ],
      },
    ],
  ]);
  render(
    <ChatScreen
      serverId="host-a"
      chatId="question-chat"
      title="Questions"
      bots={BOTS}
      transcript={[]}
      liveHeads={liveHeads}
      onSubmitMessage={vi.fn(async () => {})}
    />,
  );
  expect(screen.queryByTestId("turn-working-indicator")).toBeNull();
  const card = screen.getByTestId("permission-card");
  expect(card.getAttribute("data-kind")).toBe("question");
  expect(card.getAttribute("data-agent")).toBe("agent-r");
  expect(card.getAttribute("data-server")).toBe("host-a");
  expect(screen.queryByRole("form")).toBeNull();
});
