// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { catalogFixtureEntry } from "../channel-catalog.fixture";
import { ChannelCatalogDetail } from "./channel-catalog-detail";

vi.mock("@/components/settings/headings/settings-section", () => ({
  SettingsSection: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));
vi.mock("@/components/ui/alert", () => ({ Alert: () => null }));
vi.mock("@/components/ui/button", () => ({
  Button: (props: { children?: ReactNode }) => <button type="button">{props.children}</button>,
}));
vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ label }: { label: string }) => <span>{label}</span>,
}));

const FEISHU = catalogFixtureEntry("feishu");
const FEISHU_ROW = {
  channel: "feishu",
  label: FEISHU.label,
  entry: FEISHU,
  status: "in-repo" as const,
  connectable: true,
  accounts: [],
};

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("labels the webhook transport Not supported yet and leaves the long connection as is", () => {
  render(<ChannelCatalogDetail row={FEISHU_ROW} />);
  const webhook = screen.getByText("Event subscription webhook").parentElement!.parentElement!;
  expect(within(webhook).getByText("Not supported yet")).toBeTruthy();
  const longConnection = screen.getByText("Long connection").parentElement!.parentElement!;
  expect(within(longConnection).queryByText("Not supported yet")).toBeNull();
  expect(screen.getAllByText("Not supported yet")).toHaveLength(1);
});
