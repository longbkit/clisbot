// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  chat: null as unknown,
  error: null as string | null,
  transcriptError: null as string | null,
  retainAccepted: false,
  fetching: false,
  empty: false,
  online: true,
  epoch: 1,
  generation: 1,
  principal: "principal",
  authFailure: false,
  workspaceMounts: 0,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  View: ({
    children,
    testID,
    pointerEvents,
    accessibilityRole,
    accessibilityLabel,
    ...rest
  }: React.PropsWithChildren<{
    testID?: string;
    pointerEvents?: string;
    accessibilityRole?: string;
    accessibilityLabel?: string;
  }>) => (
    <div
      {...rest}
      data-testid={testID}
      data-pointer-events={pointerEvents}
      role={accessibilityRole}
      aria-label={accessibilityLabel}
    >
      {children}
    </div>
  ),
  Text: "span",
}));
vi.mock("@/timeline/sync-status", () => ({
  TimelineSyncStatus: ({ sync }: { sync: { status: string } }) => <aside>{sync.status}</aside>,
}));
vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => <i data-testid="spinner" />,
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: (component: unknown) => component,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ serverId: "host", chatId: "chat" }),
}));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
vi.mock("@/components/headers/menu-header", () => ({
  MenuHeader: () => <button type="button">Back</button>,
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => true }));
vi.mock("@/stores/session-store", () => ({ useSessionStore: () => false }));
vi.mock("@/components/host-route-bootstrap-boundary", () => ({
  HostRouteBootstrapBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => null,
  useHostRuntimeConnectionStatus: () => (state.online ? "online" : "offline"),
  useHostRuntimeSnapshot: () => ({
    clientGeneration: state.generation,
    connectionEpoch: state.epoch,
    authFailureReason: state.authFailure ? "incorrect_password" : null,
    lastError: "Authentication failed",
  }),
}));
vi.mock("../feature", () => ({ useHostBotsFeature: () => true }));
vi.mock("../data/resource-principal-scope", () => ({
  useResourcePrincipalScope: () => state.principal,
}));
vi.mock("../data/runtime", () => ({
  botsRuntime: {},
  useBotCatalog: () => ({ bots: { loadState: { status: "loading" } }, chats: {} }),
}));
vi.mock("./use-chat-record", () => ({
  acceptedChatRecord: () => null,
  useChatRecord: () => ({
    chat: state.chat,
    setChat: () => {},
    error: state.error,
    setError: () => {},
  }),
}));
vi.mock("../data/use-chat-transcript", () => ({
  useChatTranscriptQuery: () => ({
    transcript: { messages: state.empty ? [] : [{ id: "accepted-message" }] },
    loadState: state.transcriptError
      ? { status: "error", message: state.transcriptError, retainAccepted: state.retainAccepted }
      : { status: state.fetching || state.empty ? "loading" : "loaded" },
    loadOlder: async () => {},
    isFetching: state.fetching,
  }),
}));
vi.mock("./use-chat-visibility", () => ({ useChatVisibility: () => {} }));
vi.mock("./use-chat-live-heads", () => ({ useChatLiveHeads: () => new Map() }));
vi.mock("./use-chat-send", () => ({ useChatSend: () => ({ sending: false, send: () => {} }) }));
vi.mock("@/clisbot/connectors/chat-tools", async () => ({
  ChatToolsContext: React.createContext(null),
  useChatToolsValue: () => null,
}));
vi.mock("./use-chat-tool-activity-header", () => ({ useChatToolActivityHeaderValue: () => null }));
vi.mock("./tool-activity", () => ({ conversationToolDisplay: () => "expanded" }));
vi.mock("./chat-options", () => ({ ChatOptions: () => null }));
vi.mock("@/clisbot/heartbeats/chat-heartbeats-button", () => ({
  ChatHeartbeatsButton: () => null,
}));
vi.mock("./participant-actions", () => ({ ParticipantActions: () => null }));
vi.mock("./stop-all-action", () => ({ StopAllAction: () => null }));
vi.mock("./conversation-workspace", () => ({
  ConversationWorkspace: ({ children }: { children: React.ReactNode }) => {
    React.useEffect(() => {
      state.workspaceMounts++;
    }, []);
    return (
      <section data-testid="workspace">
        <button type="button">Back</button>
        {children}
      </section>
    );
  },
}));
vi.mock("./chat-screen", () => ({
  ChatScreen: ({ transcript }: { transcript: { id: string }[] }) => (
    <article>{transcript[0]?.id}</article>
  ),
}));
import ChatRoute from "./chat-route";
afterEach(() => {
  cleanup();
  state.chat = null;
  state.error = null;
  state.transcriptError = null;
  state.retainAccepted = false;
  state.fetching = false;
  state.empty = false;
  state.online = true;
  state.epoch = 1;
  state.generation = 1;
  state.principal = "principal";
  state.authFailure = false;
  state.workspaceMounts = 0;
});
it("keeps the same conversation chrome through metadata loading, accepted content, refresh and transcript error", () => {
  const view = render(<ChatRoute />);
  const back = screen.getByRole("button", { name: "Back" });
  expect(screen.getByText("bots.chat.route.loading")).toBeTruthy();
  expect(screen.getByTestId("spinner")).toBeTruthy();
  state.chat = { id: "chat", participants: [], title: "Accepted" };
  view.rerender(<ChatRoute />);
  expect(screen.getByText("accepted-message")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Back" })).toBe(back);
  state.transcriptError = "Transcript denied";
  view.rerender(<ChatRoute />);
  expect(screen.getAllByText("Transcript denied").length).toBeGreaterThan(0);
  expect(screen.queryByText("accepted-message")).toBeNull();
  expect(screen.getByRole("button", { name: "Back" })).toBe(back);
  expect(state.workspaceMounts).toBe(1);
});
it("keeps navigation for unavailable/offline content without remounting on a same-client epoch", () => {
  state.error = "Unavailable";
  state.online = false;
  const view = render(<ChatRoute />);
  const workspace = screen.getByTestId("workspace");
  expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  expect(screen.queryByText("accepted-message")).toBeNull();
  state.epoch = 2;
  view.rerender(<ChatRoute />);
  expect(screen.getByTestId("workspace")).toBe(workspace);
  expect(state.workspaceMounts).toBe(1);
});

it("retains the accepted body/composer through an explicitly classified transport refresh error", () => {
  state.chat = { id: "chat", participants: [], title: "Accepted" };
  const view = render(<ChatRoute />);
  const body = screen.getByText("accepted-message");
  state.transcriptError = "Connection timeout";
  state.retainAccepted = true;
  view.rerender(<ChatRoute />);
  expect(screen.getByText("accepted-message")).toBe(body);
  expect(screen.queryByText("Connection timeout")).toBeNull();
  expect(screen.getByText("catching_up")).toBeTruthy();
  expect(state.workspaceMounts).toBe(1);
});

it("hides accepted metadata/body on explicit current-admission authentication failure while keeping Back", () => {
  state.chat = { id: "chat", participants: [], title: "Accepted" };
  const view = render(<ChatRoute />);
  expect(screen.getByText("accepted-message")).toBeTruthy();
  state.authFailure = true;
  state.online = false;
  view.rerender(<ChatRoute />);
  expect(screen.queryByText("accepted-message")).toBeNull();
  expect(screen.getByText("Authentication failed")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
});

it("shows non-intercepting initial and refresh progress without replacing the accepted body or Back", () => {
  state.chat = { id: "chat", participants: [], title: "Accepted" };
  state.empty = true;
  state.fetching = true;
  const view = render(<ChatRoute />);
  const back = screen.getByRole("button", { name: "Back" });
  expect(screen.getByTestId("chat-initial-loading").getAttribute("data-pointer-events")).toBe(
    "none",
  );
  state.empty = false;
  view.rerender(<ChatRoute />);
  const body = screen.getByText("accepted-message");
  expect(screen.getByTestId("chat-refresh-loading").getAttribute("data-pointer-events")).toBe(
    "none",
  );
  expect(screen.queryByTestId("chat-initial-loading")).toBeNull();
  state.fetching = false;
  view.rerender(<ChatRoute />);
  expect(screen.queryByTestId("chat-refresh-loading")).toBeNull();
  expect(screen.getByText("accepted-message")).toBe(body);
  expect(screen.getByRole("button", { name: "Back" })).toBe(back);
  expect(state.workspaceMounts).toBe(1);
});

it("preserves body and navigation identity through disconnect/reconnect and shows the existing floating sync status", () => {
  state.chat = { id: "chat", participants: [], title: "Accepted" };
  const view = render(<ChatRoute />);
  const body = screen.getByText("accepted-message");
  const back = screen.getByRole("button", { name: "Back" });
  state.online = false;
  view.rerender(<ChatRoute />);
  expect(screen.getByText("accepted-message")).toBe(body);
  expect(screen.getByText("reconnecting")).toBeTruthy();
  state.online = true;
  state.epoch++;
  state.fetching = true;
  view.rerender(<ChatRoute />);
  expect(screen.getByText("accepted-message")).toBe(body);
  expect(screen.getByRole("button", { name: "Back" })).toBe(back);
  expect(screen.getByText("catching_up")).toBeTruthy();
  expect(state.workspaceMounts).toBe(1);
});
it.each(["generation", "principal"] as const)(
  "replaces the presentation when %s changes",
  (field) => {
    state.chat = { id: "chat", participants: [], title: "Accepted" };
    const view = render(<ChatRoute />);
    const workspace = screen.getByTestId("workspace");
    if (field === "generation") state.generation++;
    else state.principal = "other-principal";
    state.chat = null;
    state.empty = true;
    view.rerender(<ChatRoute />);
    expect(screen.getByTestId("workspace")).not.toBe(workspace);
    expect(screen.queryByText("accepted-message")).toBeNull();
  },
);
