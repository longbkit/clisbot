// @vitest-environment jsdom
/* eslint-disable react-perf/jsx-no-new-function-as-prop -- lightweight UI fixtures */
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AutomationsLandingScreen } from "./screen";
const state = vi.hoisted(() => ({ enabled: true, bots: false }));
vi.mock("react-native", () => ({
  View: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("../hub/account-provider", () => ({ useHubAccount: () => ({ enabled: state.enabled }) }));
vi.mock("../bots/feature", () => ({ useBotsFeatureHosts: () => (state.bots ? [{}] : []) }));
vi.mock("@/components/headers/menu-header", () => ({
  MenuHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("../hub/settings/view-tabs", () => ({
  ViewTabs: ({
    tabs,
    onChange,
  }: {
    tabs: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <>
      {tabs.map((tab) => (
        <button type="button" key={tab.value} onClick={() => onChange(tab.value)}>
          {tab.label}
        </button>
      ))}
    </>
  ),
}));
vi.mock("@/screens/schedules-screen", () => ({
  SchedulesScreen: () => <p>Original schedules</p>,
  SchedulesScreenContent: () => <p>Embedded schedules</p>,
}));
vi.mock("./home", () => ({
  AutomationsHome: ({
    onSchedules,
    onAutomations,
  }: {
    onSchedules: () => void;
    onAutomations: (create: boolean) => void;
  }) => (
    <>
      <button type="button" onClick={onSchedules}>
        See schedules
      </button>
      <button type="button" onClick={() => onAutomations(true)}>
        New automation
      </button>
    </>
  ),
}));
vi.mock("../hub/automations-screen", () => ({
  AutomationsScreen: ({ initialCreate }: { initialCreate: boolean }) => {
    const [draft, setDraft] = useState("");
    return (
      <>
        <p>{initialCreate ? "Create workflow" : "Workflow list"}</p>
        <input
          aria-label="Workflow draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </>
    );
  },
}));
beforeEach(() => {
  vi.stubGlobal("React", React);
  state.enabled = true;
  state.bots = false;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("preserves upstream when no Fusion capability is present", () => {
  state.enabled = false;
  render(<AutomationsLandingScreen />);
  expect(screen.getByText("Original schedules")).toBeTruthy();
});
it("opens the existing creation path and retains its draft across tabs", () => {
  render(<AutomationsLandingScreen />);
  fireEvent.click(screen.getByText("New automation"));
  expect(screen.getByText("Create workflow")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Workflow draft"), { target: { value: "Daily brief" } });
  fireEvent.click(screen.getByText("Schedules"));
  expect(screen.getByText("Embedded schedules")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Automations" }));
  expect((screen.getByLabelText("Workflow draft") as HTMLInputElement).value).toBe("Daily brief");
});
it("makes the landing available on a bots Host without Hub", () => {
  state.enabled = false;
  state.bots = true;
  render(<AutomationsLandingScreen />);
  expect(screen.getByText("Home")).toBeTruthy();
});
