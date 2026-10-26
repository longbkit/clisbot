// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useQuickStartAutoSend } from "./use-quick-start-auto-send";

type Props = Parameters<typeof useQuickStartAutoSend>[0];

function setup(overrides: Partial<Props> = {}) {
  const submit = vi.fn();
  const initial: Props = {
    serverId: "host",
    applying: true,
    checks: [],
    attachments: 0,
    cwd: "/repo",
    submit,
    ...overrides,
  };
  const hook = renderHook((props: Props) => useQuickStartAutoSend(props), {
    initialProps: initial,
  });
  act(() => hook.result.current({ serverId: "host", text: "Fix the bug" }));
  return {
    submit,
    finish: (patch: Partial<Props> = {}) =>
      hook.rerender({ ...initial, applying: false, ...patch }),
  };
}

describe("useQuickStartAutoSend", () => {
  it("waits for the template, then sends its prompt once", () => {
    const { submit, finish } = setup();
    expect(submit).not.toHaveBeenCalled();
    finish();
    finish();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({ text: "Fix the bug", attachments: [], cwd: "/repo" });
  });

  it("leaves the filled composer when the reader must check something", () => {
    for (const patch of [
      { checks: ["Confirm the model"] },
      { checks: [false, true] },
      { attachments: 1 },
      { serverId: "other" },
    ]) {
      const { submit, finish } = setup();
      finish(patch);
      finish();
      expect(submit, JSON.stringify(patch)).not.toHaveBeenCalled();
    }
  });
});
