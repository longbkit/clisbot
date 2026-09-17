import type { PaneHost } from "@/panels/panel-manifest";
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
import { SessionActorLabel } from "./actor";
import { userProfilePanelRegistration } from "./profile-panel";
import { WorkspaceMetadataRow } from "./workspace-metadata-row";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { DEFAULT_SIDEBAR_ROW_ITEMS } from "@/components/sidebar/display-preferences/row-items";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";

const boundary = vi.hoisted(() => ({
  actor: {} as SessionActor,
  visible: {} as Record<string, boolean>,
  roster: [] as unknown[],
  linked: [] as unknown[],
}));
vi.mock("expo-router", () => ({
  router: { push: vi.fn(), replace: vi.fn() },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useLocalSearchParams: () => ({}),
}));
// The Hub account and its Channel-identity reads are network boundaries; the
// panel's own resolution of person, avatar and linked identities is production code.
vi.mock("@/clisbot/hub/account-provider", () => ({
  useHubAccount: () => ({ signedIn: { team: { members: boundary.roster } } }),
}));
vi.mock("@/clisbot/hub/channel-identity-directory", () => ({
  useChannelIdentityDirectory: () => ({
    identitiesOf: (memberId: string | null | undefined) =>
      boundary.linked.filter(
        (identity) => (identity as { memberId: string }).memberId === memberId,
      ),
    pending: false,
    error: null,
  }),
}));
// Animation timing belongs to the Metro route test. Reanimated's exit animation
// cannot recover native style metadata from the browser project's Unistyles stub.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-native-reanimated")>();
  const { View } = await import("react-native");
  return { ...original, default: { ...original.default, View } };
});
// Storage and pane/provider context are the harness boundaries. The actor controls,
// Tooltip, profile panel, layout store/actions, and metadata row are production code.
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => localStorage.getItem(key),
    setItem: async (key: string, value: string) => localStorage.setItem(key, value),
    removeItem: async (key: string) => localStorage.removeItem(key),
  },
}));
vi.mock("@/panels/pane-context", () => ({
  usePaneContext: () => ({ target: { kind: "user_profile", actor: boundary.actor } }),
}));
vi.mock("@/plugins/workspace-panels/locations", async () => {
  const { panelSupportsHost } = await import("@/panels/panel-manifest");
  return {
    panelTargetSupportsHostForWorkspaceKey: (
      _key: string,
      target: { kind: "user_profile" },
      host: PaneHost,
    ) => panelSupportsHost(target.kind, host),
  };
});
vi.mock("./capability", () => ({
  useSessionStorageEnabled: () => true,
  useSessionStorageReadable: () => true,
}));
vi.mock("@/components/sidebar/display-preferences/model", () => ({
  useSidebarRowItems: () => boundary.visible,
}));
vi.mock("react-native-unistyles", async () => {
  const { lightTheme } = await import("@/styles/theme");
  const { StyleSheet } = await import("react-native");
  return {
    StyleSheet: {
      ...StyleSheet,
      create: <T,>(styles: T | ((theme: typeof lightTheme) => T)): T =>
        typeof styles === "function"
          ? (styles as (theme: typeof lightTheme) => T)(lightTheme)
          : styles,
    },
    withUnistyles: <T,>(component: T): T => component,
    useUnistyles: () => ({
      theme: lightTheme,
      rt: { breakpoint: window.innerWidth < 500 ? "xs" : "lg" },
    }),
  };
});

const actor: SessionActor = {
  kind: "user",
  id: "slack:U1",
  displayName: "Alex",
  hubOrigin: "https://hub.one",
  organizationId: "org-one",
  connectionId: "slack-one",
  memberId: "member-one",
};
const workspaceKey = buildWorkspaceTabPersistenceKey({
  serverId: "host",
  workspaceId: "workspace",
})!;
const Profile = userProfilePanelRegistration.component;

const workspace: SidebarWorkspaceEntry = {
  workspaceKey,
  serverId: "host",
  workspaceId: "workspace",
  projectViewKey: "project",
  projectName: "Project",
  projectKind: "git",
  workspaceKind: "local_checkout",
  name: "Workspace",
  statusBucket: "done",
  statusEnteredAt: null,
  workspaceDirectory: "/project",
  workspaceDirectoryLabel: "project",
  title: null,
  currentBranch: null,
  archivingAt: null,
  diffStat: null,
  prHint: null,
  archiveHasUncommittedChanges: null,
  archiveUnpushedCommitCount: null,
  scripts: [],
  hasRunningScripts: false,
  createdBy: actor,
  lastInteractionBy: { ...actor, id: "slack:U2", displayName: "Bailey" },
  createdAt: "2026-01-01T12:00:00Z",
  lastInteractionAt: "2026-01-02T12:00:00Z",
  channels: [
    {
      hubOrigin: actor.hubOrigin!,
      organizationId: actor.organizationId!,
      connectionId: actor.connectionId!,
      channelId: "C1",
      displayName: "general",
    },
  ],
};
/** The same verified Member, arriving through a second Channel account. */
const otherConnectionActor = { ...actor, id: "telegram:9", connectionId: "telegram-one" };
/** A sender with no Hub Member behind them, so there is no person to merge into. */
const unlinkedActor = {
  ...actor,
  id: "slack:U9",
  displayName: "Unlinked",
  memberId: undefined,
};
const failedAvatarActor = { ...actor, avatarUrl: "data:image/png;base64,broken" };
const emptyWorkspace = {
  ...workspace,
  createdBy: undefined,
  lastInteractionBy: undefined,
  channels: [],
  createdAt: undefined,
  lastInteractionAt: undefined,
};

beforeEach(() => {
  vi.stubGlobal("React", React);
  boundary.actor = actor;
  boundary.visible = { ...DEFAULT_SIDEBAR_ROW_ITEMS };
  boundary.roster = [];
  boundary.linked = [];
  useWorkspaceLayoutStore.setState({ layoutByWorkspace: {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("opens profiles by keyboard and click, shows scoped snapshots, and keeps one tab per person", async () => {
  await page.viewport(1200, 800);
  render(<SessionActorLabel actor={actor} serverId="host" workspaceId="workspace" />);
  const trigger = screen.getByRole("button", { name: "Open profile: Alex (slack:U1)" });
  await userEvent.hover(trigger);
  expect(await screen.findByText(actor.id, { exact: true })).toBeTruthy();
  await userEvent.unhover(trigger);
  await userEvent.tab();
  expect(document.activeElement).toBe(trigger);
  await userEvent.keyboard("{Enter}");
  expect(
    useWorkspaceLayoutStore
      .getState()
      .getWorkspaceTabs(workspaceKey)
      .filter((tab) => tab.target.kind === "user_profile"),
  ).toHaveLength(1);
  await userEvent.click(trigger);
  expect(
    useWorkspaceLayoutStore
      .getState()
      .getWorkspaceTabs(workspaceKey)
      .filter((tab) => tab.target.kind === "user_profile"),
  ).toHaveLength(1);
  // The same Member through a second Channel account is the same person: one tab.
  render(
    <SessionActorLabel actor={otherConnectionActor} serverId="host" workspaceId="workspace" />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Open profile: Alex (telegram:9)" }));
  expect(
    useWorkspaceLayoutStore
      .getState()
      .getWorkspaceTabs(workspaceKey)
      .filter((tab) => tab.target.kind === "user_profile"),
  ).toHaveLength(1);
  // An unlinked sender has no Member to merge into, so it stays its own profile.
  render(<SessionActorLabel actor={unlinkedActor} serverId="host" workspaceId="workspace" />);
  await userEvent.click(screen.getByRole("button", { name: "Open profile: Unlinked (slack:U9)" }));
  expect(
    useWorkspaceLayoutStore
      .getState()
      .getWorkspaceTabs(workspaceKey)
      .filter((tab) => tab.target.kind === "user_profile"),
  ).toHaveLength(2);
  render(<Profile />);
  const profile = screen.getByTestId("user-profile-panel");
  for (const value of [
    actor.id,
    actor.hubOrigin!,
    actor.organizationId!,
    actor.connectionId!,
    actor.memberId!,
  ])
    expect(profile.textContent).toContain(value);
  await page.screenshot({ path: "/tmp/session-profile-desktop.png" });
});

it("shows one person, their linked Channels, and the snapshot it was recorded from", async () => {
  await page.viewport(1200, 800);
  boundary.roster = [
    {
      id: "member-one",
      userId: "user-one",
      name: "Alex Nguyen",
      email: "alex@example.com",
      image: "https://cdn.example/alex.png",
    },
  ];
  boundary.linked = [
    { id: "i1", memberId: "member-one", label: "Slack · Acme", subject: "@alex" },
    { id: "i2", memberId: "member-one", label: "Telegram · Acme", subject: "alex_ng" },
    { id: "i3", memberId: "member-two", label: "Slack · Acme", subject: "@bailey" },
  ];
  render(<Profile />);
  const text = screen.getByTestId("user-profile-panel").textContent ?? "";
  // The Hub user, not the Slack identity, names the person.
  expect(text).toContain("Alex Nguyen");
  expect(text).toContain("alex@example.com");
  expect(text).toContain("user-one");
  // Every Channel they linked, not only the one this session saw.
  for (const shown of ["@alex", "Slack · Acme", "alex_ng", "Telegram · Acme"])
    expect(text).toContain(shown);
  // Someone else's link never leaks into this profile.
  expect(text).not.toContain("@bailey");
  // The snapshot stays visible as provenance.
  expect(text).toContain(actor.id);
  const avatar = screen.getByTestId("user-profile-panel").querySelector("img");
  expect(avatar?.getAttribute("src")).toBe("https://cdn.example/alex.png");
  await page.screenshot({ path: "/tmp/session-profile-person.png" });
});

it("derives the monogram from the same name it shows, not the frozen one", async () => {
  await page.viewport(1200, 800);
  // Renamed since the snapshot, and with no image: the face falls back to a monogram.
  boundary.roster = [
    { id: "member-one", userId: "user-one", name: "Bao Tran", email: "bao@example.com" },
  ];
  boundary.actor = { ...actor, displayName: "Alex" };
  render(<Profile />);
  const panel = screen.getByTestId("user-profile-panel");
  expect(panel.textContent).toContain("Bao Tran");
  expect(panel.textContent).not.toContain("Alex");
  // "BT" from the name on screen — never "A" from the name the snapshot froze.
  expect(panel.textContent).toContain("BT");
});

it("opens at narrow layout without hover and renders Automation without exposing its ID as name", async () => {
  await page.viewport(390, 844);
  boundary.actor = { kind: "automation", id: "automation-opaque-id" };
  render(<SessionActorLabel actor={boundary.actor} serverId="host" workspaceId="workspace" />);
  const trigger = screen.getByRole("button", { name: /Open profile: Automation/ });
  // Monogram ("A") plus label; the opaque automation ID stays out of the name.
  expect(trigger.textContent).toBe("AAutomation");
  await userEvent.click(trigger);
  expect(
    useWorkspaceLayoutStore
      .getState()
      .getWorkspaceTabs(workspaceKey)
      .some((tab) => tab.target.kind === "user_profile"),
  ).toBe(true);
  render(<Profile />);
  expect(screen.getByTestId("user-profile-panel").textContent).toContain("automation-opaque-id");
  await page.screenshot({ path: "/tmp/session-profile-narrow.png" });
});

it("replaces failed avatars with an initials monogram, keeping the profile control", async () => {
  render(<SessionActorLabel actor={failedAvatarActor} serverId="host" workspaceId="workspace" />);
  await waitFor(() => expect(screen.queryByRole("img")).toBeNull());
  // "Alex" monogram is the single-letter fallback rendered in the face.
  expect(screen.getByText("A", { exact: true })).toBeTruthy();
  const trigger = screen.getByRole("button", { name: "Open profile: Alex (slack:U1)" });
  await userEvent.click(trigger);
  expect(
    useWorkspaceLayoutStore
      .getState()
      .getWorkspaceTabs(workspaceKey)
      .some((tab) => tab.target.kind === "user_profile"),
  ).toBe(true);
});

it("renders the five metadata facts independently and gives all space back for missing data", async () => {
  await page.viewport(1200, 800);

  const view = render(<WorkspaceMetadataRow workspace={workspace} />);
  const facts = ["createdUser", "channels", "updatedUser", "createdTime", "updatedTime"] as const;
  for (const fact of facts) {
    boundary.visible = {
      ...DEFAULT_SIDEBAR_ROW_ITEMS,
      ...Object.fromEntries(facts.map((key) => [key, key === fact])),
    };
    view.rerender(<WorkspaceMetadataRow workspace={workspace} />);
    expect(view.container.textContent).not.toBe("");
    expect(view.container.textContent).not.toContain("·");
    expect(screen.queryByText("Alex") !== null).toBe(fact === "createdUser");
    expect(screen.queryByText("Bailey") !== null).toBe(fact === "updatedUser");
  }
  // A sidebar row is one press target; its names are text, not controls that could take it.
  expect(screen.queryByRole("button", { name: /Open profile/ })).toBeNull();
  boundary.visible = {
    ...DEFAULT_SIDEBAR_ROW_ITEMS,
    ...Object.fromEntries(facts.map((key) => [key, true])),
  };
  view.rerender(<WorkspaceMetadataRow workspace={emptyWorkspace} />);
  expect(view.container.childElementCount).toBe(0);
});
