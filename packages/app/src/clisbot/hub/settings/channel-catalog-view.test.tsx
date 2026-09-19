// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChannelCatalogView } from "./channel-catalog-view";

const layout = vi.hoisted(() => ({ compact: false }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => layout.compact }));
vi.mock("./channel-catalog-queries", () => ({
  useChannelCatalogQueries: () => ({
    rows: [
      { channel: "slack", label: "Slack", accounts: [], connectable: true },
      { channel: "telegram", label: "Telegram", accounts: [], connectable: true },
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
  ChannelCatalogDetail: (props: { row: { label: string } }) => (
    <h2>{`${props.row.label} detail`}</h2>
  ),
}));
vi.mock("@/components/ui/alert", () => ({ Alert: () => null }));
vi.mock("./channel-support-section", () => ({ ChannelSupportSection: () => null }));
vi.mock("./channel-connection-setup", () => ({ ChannelConnectionSetup: () => null }));
vi.mock("./channel-qr-link-panel", () => ({ ChannelQrLinkPanel: () => null }));
vi.mock("./channel-qr-verbs", () => ({
  CHANNEL_QR_OPERATIONS_AVAILABLE: false,
  useChannelQrVerbs: () => ({}),
}));
vi.mock("../channel-api", () => ({ createChannelConnection: vi.fn() }));
vi.mock("../account-provider", () => ({ useHubAccount: () => ({ api: () => ({}) }) }));
vi.mock("./channel-connection-add", () => ({ useChannelConnectionSave: () => vi.fn() }));
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
