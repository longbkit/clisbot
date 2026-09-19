// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsDetailContent, useWideContent } from "./wide-content";

vi.mock("react-native", () => ({
  View: (props: { style: unknown; children: React.ReactNode }) => (
    <div data-testid="column" data-wide={String(Array.isArray(props.style))}>
      {props.children}
    </div>
  ),
}));

function Wide({ wide }: { wide: boolean }) {
  useWideContent(wide);
  return <span>wide view</span>;
}
const BASE = { maxWidth: 720 };
const WIDE = { maxWidth: 1120 };
function Screen({ page }: { page: "form" | "table" | "phone-table" }) {
  return (
    <SettingsDetailContent style={BASE} wideStyle={WIDE} onNavigate={vi.fn()}>
      {page === "form" ? <span>form</span> : <Wide wide={page === "table"} />}
    </SettingsDetailContent>
  );
}

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("widens the column only while a view asks for it, and gives it back", () => {
  const view = render(<Screen page="form" />);
  expect(screen.getByTestId("column").dataset["wide"]).toBe("false");
  view.rerender(<Screen page="table" />);
  expect(screen.getByTestId("column").dataset["wide"]).toBe("true");
  view.rerender(<Screen page="form" />);
  expect(screen.getByTestId("column").dataset["wide"]).toBe("false");
  view.rerender(<Screen page="phone-table" />);
  expect(screen.getByTestId("column").dataset["wide"]).toBe("false");
});
