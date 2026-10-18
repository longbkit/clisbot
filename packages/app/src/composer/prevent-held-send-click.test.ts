import { expect, test } from "vitest";
import { preventHeldSendClick } from "./prevent-held-send-click.web";

test("held release cancels its compatibility click, but leaves the next deliberate tap intact", () => {
  const target = new EventTarget();
  preventHeldSendClick(target);
  const release = new Event("touchend", { cancelable: true });
  target.dispatchEvent(release);
  expect(release.defaultPrevented).toBe(true);
  const nextTap = new Event("touchend", { cancelable: true });
  target.dispatchEvent(nextTap);
  expect(nextTap.defaultPrevented).toBe(false);
});

test("cancelled or unmounted held gesture cannot consume a later touch", () => {
  for (const cancel of [false, true]) {
    const target = new EventTarget();
    const clear = preventHeldSendClick(target);
    if (cancel) target.dispatchEvent(new Event("touchcancel"));
    else clear();
    const nextTap = new Event("touchend", { cancelable: true });
    target.dispatchEvent(nextTap);
    expect(nextTap.defaultPrevented).toBe(false);
  }
});
