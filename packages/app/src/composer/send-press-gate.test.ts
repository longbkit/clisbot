import { expect, test } from "vitest";
import { SendPressGate } from "./send-press-gate";

test("a short Send tap activates primary; long press and release never do", () => {
  const gate = new SendPressGate();
  gate.begin();
  expect(gate.takePrimary()).toBe(true);
  gate.begin();
  gate.openMenu();
  expect(gate.takePrimary()).toBe(false);
  gate.begin();
  expect(gate.takePrimary()).toBe(true);
});
test("dismissal without a native release callback leaves the next deliberate tap usable", () => {
  const gate = new SendPressGate();
  gate.begin();
  gate.openMenu();
  // Some platforms suppress onPress themselves after a long press.
  gate.begin();
  expect(gate.takePrimary()).toBe(true);
});
