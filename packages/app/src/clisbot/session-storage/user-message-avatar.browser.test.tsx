import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
import { AssistantMessage, UserMessage } from "@/components/message";
import { AssistantFileLinkResolverProvider } from "@/assistant-file-links/provider";
import { ACTOR_AVATAR_SIZE } from "./actor-metrics";
import { AgentFace } from "./actor";
import { i18n } from "@/i18n/i18next";

// UserMessage pulls in useRewindAgentMutation -> useToast; the rewind path is
// never exercised here, so satisfy the hook with a no-op API instead of
// mounting the app's toast provider.
vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({
    show: () => undefined,
    copied: () => undefined,
    error: () => undefined,
  }),
}));

const boundary = vi.hoisted(() => ({ hub: null as unknown }));
vi.mock("@/clisbot/hub/account-provider", () => ({
  useHubAccount: () => boundary.hub,
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

const me = {
  kind: "user" as const,
  id: "me-id",
  displayName: "Me",
};
const other: SessionActor = {
  kind: "user",
  id: "other-id",
  displayName: "Alex",
};

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </I18nextProvider>,
  );
}

function messageProps(overrides: Partial<Parameters<typeof UserMessage>[0]> = {}) {
  return {
    message: "Hello",
    timestamp: Date.parse("2026-01-02T12:00:00Z"),
    serverId: "host",
    workspaceId: "workspace",
    ...overrides,
  };
}

function bubbleElement(root: HTMLElement): HTMLElement {
  // The bubble is the filled view that carries the message text.
  const bubble = [...root.querySelectorAll<HTMLElement>("div")].find(
    (el) => el.style.backgroundColor !== "" && el.textContent?.startsWith("Hello"),
  );
  expect(bubble, "expected a filled bubble inside the user message row").toBeTruthy();
  return bubble!;
}

function signedInHub() {
  return {
    enabled: true,
    origin: "https://hub.one",
    signedIn: { state: "active", account: { id: "me-id", name: "Me", email: "me@example.com" } },
    loading: false,
  };
}

beforeEach(() => {
  boundary.hub = signedInHub();
});
afterEach(() => {
  cleanup();
});

it("left-aligns another user's message with the avatar beside the name", () => {
  const view = renderWithProviders(
    <UserMessage sender={other} isFirstInGroup isLastInGroup {...messageProps()} />,
  );
  const row = screen.getByTestId("actor-response-row");
  const bubble = bubbleElement(row);
  const avatar = screen.getByRole("button", { name: "Open profile: Alex (other-id)" });
  const name = [...row.querySelectorAll<HTMLElement>("*")].find(
    (el) => el.textContent === "Alex" && el.children.length === 0,
  )!;

  // The face sits in the gutter to the left of the content, top-aligned with the
  // bubble rather than the name, and the name is flush with the bubble's edge.
  expect(avatar.getBoundingClientRect().left).toBeLessThan(bubble.getBoundingClientRect().left);
  expect(
    Math.abs(avatar.getBoundingClientRect().top - bubble.getBoundingClientRect().top),
  ).toBeLessThan(2);
  expect(
    Math.abs(name.getBoundingClientRect().left - bubble.getBoundingClientRect().left),
  ).toBeLessThan(2);
  expect(bubble.getBoundingClientRect().top - name.getBoundingClientRect().bottom).toBeLessThan(4);
  // Both faces share the same size so the timeline reads as one column.
  expect(avatar.getBoundingClientRect().width).toBe(ACTOR_AVATAR_SIZE);

  // A continuation message of the same sender drops the name row.
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <UserMessage sender={other} isFirstInGroup={false} isLastInGroup {...messageProps()} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  expect(view.container.querySelector('[data-testid="actor-response-row"]')).not.toBeNull();
  expect(view.container.textContent).not.toContain("Alex");
});

it("keeps own messages right-aligned with an avatar and name", () => {
  const view = renderWithProviders(<UserMessage sender={me} {...messageProps()} />);
  const container = view.container.querySelector<HTMLElement>('[data-testid="user-message"]')!;
  expect(container).not.toBeNull();
  const row = container.querySelector<HTMLElement>('[data-testid="actor-response-row"]');
  expect(row).not.toBeNull();
  // The message row right-aligns its pair: the avatar hugs the right edge and
  // the bubble sits to its left.
  const avatar = screen.getByRole("button", { name: "Open profile: Me (me-id)" });
  const bubble = bubbleElement(container);
  const containerRect = container.getBoundingClientRect();
  expect(containerRect.right - avatar.getBoundingClientRect().right).toBeLessThan(2);
  expect(avatar.getBoundingClientRect().right).toBeGreaterThan(
    bubble.getBoundingClientRect().right,
  );
  expect(container.textContent).toContain("Me");
  // The name sits directly above the bubble with a tight gap.
  const name = [...row!.querySelectorAll<HTMLElement>("*")].find(
    (el) => el.textContent === "Me" && el.children.length === 0,
  );
  expect(name, "expected a sender name above the bubble").toBeTruthy();
  expect(bubble.getBoundingClientRect().top - name!.getBoundingClientRect().bottom).toBeLessThan(4);
  // The face top-aligns with the bubble, and the name is flush with its edge.
  expect(
    Math.abs(avatar.getBoundingClientRect().top - bubble.getBoundingClientRect().top),
  ).toBeLessThan(2);
  expect(
    Math.abs(name!.getBoundingClientRect().right - bubble.getBoundingClientRect().right),
  ).toBeLessThan(2);
});

it("uses the signed-in account as the sender when the message has none", () => {
  const view = renderWithProviders(<UserMessage {...messageProps()} />);
  const container = view.container.querySelector<HTMLElement>('[data-testid="user-message"]')!;
  // The account names and faces the row instead of the old hardcoded fallback.
  expect(container.textContent).toContain("Me");
  expect(screen.getByRole("button", { name: "Open profile: Me (me-id)" })).toBeTruthy();
});

it("shows avatar and name skeletons while the account is still loading", () => {
  boundary.hub = { enabled: true, origin: "https://hub.one", signedIn: null, loading: true };
  const view = renderWithProviders(<UserMessage {...messageProps()} />);
  expect(view.container.querySelector('[data-testid="actor-avatar-skeleton"]')).not.toBeNull();
  expect(view.container.querySelector('[data-testid="actor-name-skeleton"]')).not.toBeNull();
  // The row stays right-aligned while the identity resolves.
  const container = view.container.querySelector<HTMLElement>('[data-testid="user-message"]')!;
  const row = container.querySelector<HTMLElement>('[data-testid="actor-response-row"]');
  expect(row).not.toBeNull();
});

it("keeps a sender-less message with no account on the right without a name or avatar", () => {
  boundary.hub = { enabled: true, origin: "https://hub.one", signedIn: null, loading: false };
  const view = renderWithProviders(<UserMessage {...messageProps()} />);
  const container = view.container.querySelector<HTMLElement>('[data-testid="user-message"]')!;
  const gutter = screen.getByTestId("actor-response-gutter");
  expect(gutter.childElementCount).toBe(0);
  expect(container.textContent).not.toMatch(/You|Unknown sender|Me/);
  expect(container.querySelector('[data-testid="actor-name-skeleton"]')).toBeNull();
  const row = screen.getByTestId("actor-response-row");
  expect(getComputedStyle(row).flexDirection).toBe("row-reverse");
  const bubble = bubbleElement(container).getBoundingClientRect();
  expect(bubble.left).toBeGreaterThan(container.getBoundingClientRect().left);
  expect(bubble.right).toBeLessThanOrEqual(gutter.getBoundingClientRect().left);
});

it("renders the agent face as a rounded badge without a monogram at the shared size", () => {
  const view = renderWithProviders(<AgentFace />);
  const face = view.container.firstElementChild as HTMLElement;
  expect(face.textContent).toBe("");
  const rect = face.getBoundingClientRect();
  expect(rect.width).toBe(ACTOR_AVATAR_SIZE);
  expect(rect.height).toBe(ACTOR_AVATAR_SIZE);
  expect(face.style.backgroundColor).not.toBe("");
});

function renderReply(message: string, underSenderName: boolean) {
  const view = renderWithProviders(
    <AssistantFileLinkResolverProvider>
      <AssistantMessage
        occurrenceKey="agent-reply"
        message={message}
        timestamp={Date.parse("2026-01-02T12:00:00Z")}
        underSenderName={underSenderName}
        phase="complete"
      />
    </AssistantFileLinkResolverProvider>,
  );
  const container = view.container.querySelector<HTMLElement>('[data-testid="assistant-message"]')!;
  return { container, firstBlock: container.firstElementChild as HTMLElement };
}

it("drops the leading heading margin only for the reply under a sender name", () => {
  // theme.spacing[6] = 24 cancels the h1 marginTop so the face meets the text.
  const under = renderReply("# Answer\n\nbody", true);
  expect(under.firstBlock.style.marginTop).toBe("-24px");
  expect(getComputedStyle(under.container).paddingTop).toBe("0px");
  cleanup();

  // A reply further down the same response keeps upstream markdown spacing.
  const inside = renderReply("# Answer\n\nbody", false);
  expect(Number.parseFloat(inside.firstBlock.style.marginTop || "0")).toBe(0);
  expect(getComputedStyle(inside.container).paddingTop).not.toBe("0px");
});

it("keeps a leading paragraph flush without a negative margin", () => {
  const { firstBlock } = renderReply("plain reply", true);
  expect(Number.parseFloat(firstBlock.style.marginTop || "0")).toBe(0);
});
