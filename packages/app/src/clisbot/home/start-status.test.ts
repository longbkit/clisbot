import { expect, test } from "vitest";
import { startStatusLabel } from "./start-status";

test("the status trigger shows ready agents out of all supported ones and flags what needs action", () => {
  expect(startStatusLabel("online", 5, 44)).toEqual({
    label: "5/44+ agents ready",
    warning: false,
  });
  expect(startStatusLabel("online", 0, 44)).toEqual({
    label: "0/44+ agents ready · Set up",
    warning: true,
  });
  expect(startStatusLabel("connecting", 0, 44)).toEqual({ label: "Connecting…", warning: false });
  expect(startStatusLabel("offline", 3, 44)).toEqual({ label: "Host offline", warning: true });
});
