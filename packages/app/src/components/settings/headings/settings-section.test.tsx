// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("@/styles/settings", () => ({ settingsStyles: {} }));
vi.mock("./settings-info-tip", () => ({ SettingsInfoTip: () => <span>info</span> }));

const { SettingsPageTitleContext, SettingsSection } = await import("./settings-section");

afterEach(cleanup);

describe("SettingsSection title", () => {
  it("drops a title that repeats the page title but keeps its info", () => {
    render(
      <SettingsPageTitleContext.Provider value="Sidebar">
        <SettingsSection title="Sidebar" info="What the sidebar shows">
          <span>rows</span>
        </SettingsSection>
        <SettingsSection title="Bottom bar">
          <span>more</span>
        </SettingsSection>
      </SettingsPageTitleContext.Provider>,
    );
    expect(screen.queryByText("Sidebar")).toBeNull();
    expect(screen.getByText("info")).toBeTruthy();
    expect(screen.getByText("Bottom bar")).toBeTruthy();
  });

  it("keeps every title outside a settings page", () => {
    render(
      <SettingsSection title="Sidebar">
        <span>rows</span>
      </SettingsSection>,
    );
    expect(screen.getByText("Sidebar")).toBeTruthy();
  });
});
