// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { useHubEditLock, useHubSwitchLocked } from "./hub-edit-lock";
function Editor() {
  useHubEditLock();
  return null;
}
function Picker() {
  return (
    <button type="button" disabled={useHubSwitchLocked()}>
      Switch Hub
    </button>
  );
}
afterEach(cleanup);
test("every mounted editor holds the common lock until successful save or Cancel removes it", () => {
  const view = render(
    <>
      <Picker />
      <Editor />
      <Editor />
    </>,
  );
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  view.rerender(
    <>
      <Picker />
      <Editor />
    </>,
  );
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<Picker />);
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
});
