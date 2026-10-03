// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { useToastHost, type ToastApi } from "./toast-host";
let api: ToastApi;
function Probe() {
  const host = useToastHost();
  api = host.api;
  return <div>{host.toast?.content}</div>;
}
afterEach(cleanup);
test("dismissing an owned error cannot remove a newer unrelated toast", () => {
  render(<Probe />);
  let pairingId: number | void;
  act(() => {
    pairingId = api.show("Pairing failed", { durationMs: null });
  });
  act(() => {
    api.show("Saved another setting");
  });
  act(() => {
    if (typeof pairingId === "number") api.dismiss?.(pairingId);
  });
  expect(screen.getByText("Saved another setting")).toBeTruthy();
  let currentId: number | void;
  act(() => {
    currentId = api.show("Pairing failed", { durationMs: null });
  });
  act(() => {
    if (typeof currentId === "number") api.dismiss?.(currentId);
  });
  expect(screen.queryByText("Pairing failed")).toBeNull();
});
