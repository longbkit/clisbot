// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChannelCatalogView } from "./channel-catalog-view";

const layout = vi.hoisted(() => ({ compact: false }));
/** A QR channel that already has an account waiting for its login. */
const qr = vi.hoisted(() => ({
  accounts: [{ accountId: "old" }] as { accountId: string }[],
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => layout.compact }));
vi.mock("./channel-catalog-queries", () => ({
  useChannelCatalogQueries: () => ({
    rows: [
      { channel: "slack", label: "Slack", accounts: [], connectable: true },
      { channel: "telegram", label: "Telegram", accounts: [], connectable: true },
      {
        channel: "whatsapp",
        label: "WhatsApp",
        accounts: qr.accounts,
        connectable: true,
        entry: { id: "whatsapp", auth: "qr" },
      },
    ],
    catalog: { availability: "available", message: null },
    refresh: vi.fn(),
    fetching: false,
    statusError: null,
  }),
}));
vi.mock("./channel-catalog-list", () => ({
  ChannelCatalogList: (props: {
    rows: { channel: string; label: string }[];
    onSelect(channel: string): void;
  }) => (
    <div>
      {props.rows.map((row) => (
        <ListRow key={row.channel} row={row} onSelect={props.onSelect} />
      ))}
    </div>
  ),
}));
function ListRow(props: { row: { channel: string; label: string }; onSelect(id: string): void }) {
  const press = React.useCallback(() => props.onSelect(props.row.channel), [props]);
  return (
    <button type="button" onClick={press}>
      {`Open ${props.row.label}`}
    </button>
  );
}
vi.mock("./channel-catalog-detail", () => ({
  ChannelCatalogDetail: (props: { row: { label: string }; onConnect?: () => void }) => (
    <div>
      <h2>{`${props.row.label} detail`}</h2>
      {props.onConnect ? (
        <button type="button" onClick={props.onConnect}>
          Connect
        </button>
      ) : null}
    </div>
  ),
}));
vi.mock("@/components/ui/alert", () => ({ Alert: () => null }));
vi.mock("./channel-support-section", () => ({ ChannelSupportSection: () => null }));
vi.mock("./channel-connection-setup", () => ({
  ChannelConnectionSetup: (props: { save(body: Record<string, unknown>): Promise<unknown> }) => (
    <SaveButton save={props.save} />
  ),
}));
function SaveButton(props: { save(body: Record<string, unknown>): Promise<unknown> }) {
  const press = React.useCallback(() => void props.save({}), [props]);
  return (
    <button type="button" onClick={press}>
      Add Connection
    </button>
  );
}
vi.mock("./channel-qr-link-panel", () => ({
  ChannelQrLinkPanel: (props: { verbs: { accountId: string }; autoStart?: boolean }) => (
    <p>{`login ${props.verbs.accountId}${props.autoStart ? " starting" : ""}`}</p>
  ),
}));
vi.mock("./channel-qr-verbs", () => ({
  CHANNEL_QR_OPERATIONS_AVAILABLE: false,
  useChannelQrVerbs: (target: { accountId: string }) => ({ accountId: target.accountId }),
}));
vi.mock("../channel-api", () => ({
  createChannelConnection: vi.fn(async () => ({ id: "c-new", provider: "whatsapp", name: "new" })),
}));
vi.mock("../channel-qr-account", () => ({
  addQrChannelAccount: vi.fn(async () => {
    qr.accounts.push({ accountId: "new" });
  }),
}));
vi.mock("../account-provider", () => ({ useHubAccount: () => ({ api: () => ({}) }) }));
vi.mock("./channel-connection-add", () => ({
  useChannelConnectionSave:
    (_entry: unknown, create: (body: Record<string, unknown>) => Promise<void>) =>
    async (body: Record<string, unknown>) => {
      await create(body);
      return null;
    },
}));
vi.mock("@/components/settings/headings/settings-section", () => ({
  SettingsSection: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: (props: { children?: ReactNode; onPress(): void; accessibilityLabel?: string }) => (
    <button type="button" aria-label={props.accessibilityLabel} onClick={props.onPress}>
      {props.children}
    </button>
  ),
}));

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows the list and the first channel side by side on a wide screen", () => {
  layout.compact = false;
  render(<ChannelCatalogView />);
  expect(screen.getByText("Slack detail")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open Telegram" }));
  expect(screen.getByText("Telegram detail")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open Slack" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Back to Channel Integrations" })).toBeNull();
});

it("opens a channel on its own screen on a phone, with a way back", () => {
  layout.compact = true;
  render(<ChannelCatalogView />);
  expect(screen.queryByText("Slack detail")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Telegram" }));
  expect(screen.getByText("Telegram detail")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open Slack" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back to Channel Integrations" }));
  expect(screen.getByRole("button", { name: "Open Slack" })).toBeTruthy();
});

it("starts the login of the account just added, not an older one, and only once", async () => {
  layout.compact = false;
  render(<ChannelCatalogView />);
  fireEvent.click(screen.getByRole("button", { name: "Open WhatsApp" }));
  expect(screen.getByText("login old")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Connection" }));
  expect(await screen.findByText("login new starting")).toBeTruthy();
  // Leaving the channel forgets it: coming back does not log in again.
  fireEvent.click(screen.getByRole("button", { name: "Open Slack" }));
  fireEvent.click(screen.getByRole("button", { name: "Open WhatsApp" }));
  expect(screen.queryByText(/starting/)).toBeNull();
});
