// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComposerTextSource } from "./text-source";
import { useSendErrorDraftReset } from "./use-send-error-draft-reset";

function textSource(initial: string) {
  let value = initial;
  const listeners = new Set<() => void>();
  const source: ComposerTextSource = {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    source,
    set(next: string) {
      value = next;
      listeners.forEach((listener) => listener());
    },
  };
}

function mount(initial: { sendError: string | null; attachmentCount: number }) {
  const text = textSource("hello");
  const clearSendError = vi.fn();
  const view = renderHook(
    (props: typeof initial) =>
      useSendErrorDraftReset({ ...props, clearSendError, textSource: text.source }),
    { initialProps: initial },
  );
  return { ...view, text, clearSendError };
}

describe("useSendErrorDraftReset", () => {
  it("clears the error when the attachment that caused it is removed", () => {
    const { rerender, clearSendError } = mount({ sendError: "too large", attachmentCount: 2 });
    expect(clearSendError).not.toHaveBeenCalled();
    rerender({ sendError: "too large", attachmentCount: 1 });
    expect(clearSendError).toHaveBeenCalledTimes(1);
  });

  it("clears the error when the text changes", () => {
    const { text, clearSendError } = mount({ sendError: "too large", attachmentCount: 1 });
    act(() => text.set("hello!"));
    expect(clearSendError).toHaveBeenCalledTimes(1);
  });

  it("keeps an error raised after the draft was put back", () => {
    const { rerender, clearSendError } = mount({ sendError: null, attachmentCount: 0 });
    rerender({ sendError: "too large", attachmentCount: 2 });
    rerender({ sendError: "too large", attachmentCount: 2 });
    expect(clearSendError).not.toHaveBeenCalled();
  });
});
