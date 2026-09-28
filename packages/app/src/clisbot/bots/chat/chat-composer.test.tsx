// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({
  props: {} as Record<string, unknown>,
  draftKey: "",
  context: null as null | {
    agentId?: string;
    workspaceId: string;
    cwd: string;
    canConfigure: boolean;
  },
  supported: true,
}));
vi.mock("react-native", () => ({ View: ({ children }: { children: ReactNode }) => children }));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({ dock: {} }) } }));
vi.mock("@/constants/platform", () => ({ isNative: false }));
vi.mock("@/components/retained-panel", () => ({ useRetainedPanelActive: () => true }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (select: (state: unknown) => unknown) =>
    select({
      sessions: { host: { serverInfo: { features: { bots: mocks.supported } } } },
    }),
}));
vi.mock("./conversation-project-context", () => ({
  useConversationProjectContext: () => mocks.context,
}));
vi.mock("@/composer", () => ({
  Composer: (props: Record<string, unknown>) => {
    mocks.props = props;
    return null;
  },
}));
vi.mock("@/composer/draft/input-draft", () => ({
  useAgentInputDraft: ({ draftKey }: { draftKey: string }) => {
    mocks.draftKey = draftKey;
    return { attachments: [], setAttachments: vi.fn(), clear: vi.fn() };
  },
}));
import { ChatComposer } from "./chat-composer";
it("keeps one conversation draft while selected bot controls and workspace change", () => {
  mocks.context = {
    agentId: "analyst-session",
    workspaceId: "analyst-workspace",
    cwd: "/analyst",
    canConfigure: true,
  };
  const submit = vi.fn();
  const view = render(
    <ChatComposer serverId="host" chatId="group" placeholder="Message" onSubmitMessage={submit} />,
  );
  expect(mocks.props).toMatchObject({
    agentId: "analyst-session",
    workspaceId: "analyst-workspace",
    cwd: "/analyst",
    submissionTarget: "conversation",
    attachmentsEnabled: true,
    realtimeVoiceEnabled: true,
    onSubmitMessage: submit,
    showAgentControls: true,
  });
  const insertedPath = (mocks.props.resolveWorkspaceFilePath as (path: string) => string)(
    "src/app.ts",
  );
  expect(insertedPath).toBe("/analyst/src/app.ts");
  const key = mocks.draftKey;
  mocks.context = {
    agentId: "writer-session",
    workspaceId: "writer-workspace",
    cwd: "/writer",
    canConfigure: false,
  };
  view.rerender(
    <ChatComposer
      serverId="host"
      chatId="group"
      placeholder="Message Writer"
      onSubmitMessage={submit}
    />,
  );
  expect(mocks.draftKey).toBe(key);
  expect((mocks.props.resolveWorkspaceFilePath as (path: string) => string)(insertedPath)).toBe(
    "/analyst/src/app.ts",
  );
  expect(mocks.props).toMatchObject({
    agentId: "writer-session",
    cwd: "/writer",
    showAgentControls: false,
  });
});
it("explains pending voice session without disabling first-message attachments", () => {
  mocks.context = { workspaceId: "bot", cwd: "/bot", canConfigure: true };
  render(
    <ChatComposer serverId="host" chatId="new" placeholder="Message" onSubmitMessage={vi.fn()} />,
  );
  expect(mocks.props).toMatchObject({
    attachmentsEnabled: true,
    pendingSessionReason: "Send a message to start this bot session.",
  });
});

it("old Hosts cannot enable chat realtime voice, while the shared composer remains available", () => {
  mocks.supported = false;
  mocks.context = { agentId: "active", workspaceId: "bot", cwd: "/bot", canConfigure: true };
  render(
    <ChatComposer serverId="host" chatId="old" placeholder="Message" onSubmitMessage={vi.fn()} />,
  );
  expect(mocks.props.realtimeVoiceEnabled).toBe(false);
  mocks.supported = true;
});
