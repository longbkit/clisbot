// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComposerTextSource } from "./text-source";
import { useSendErrorDraftReset, type SentDraft } from "./use-send-error-draft-reset";

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

function mount(
  initial: { sendError: string | null; attachmentCount: number },
  options: { text?: string; sent?: SentDraft } = {},
) {
  const text = textSource(options.text ?? "hello");
  const clearSendError = vi.fn();
  const sentDraft = { current: options.sent ?? null };
  const view = renderHook(
    (props: typeof initial) =>
      useSendErrorDraftReset({ ...props, clearSendError, textSource: text.source, sentDraft }),
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

  it("keeps the error while a failed send puts the draft back after it appeared", () => {
    const sent = { text: "fix it", attachmentCount: 1 };
    const { rerender, text, clearSendError } = mount(
      { sendError: "rejected", attachmentCount: 0 },
      { text: "", sent },
    );
    rerender({ sendError: "rejected", attachmentCount: 1 });
    act(() => text.set("fix it"));
    expect(clearSendError).not.toHaveBeenCalled();
    act(() => text.set("fix it!"));
    expect(clearSendError).toHaveBeenCalledTimes(1);
  });

  it("clears the error when an image sent alone is removed", () => {
    const sent = { text: "", attachmentCount: 1 };
    const { rerender, clearSendError } = mount(
      { sendError: "too large", attachmentCount: 0 },
      { text: "", sent },
    );
    rerender({ sendError: "too large", attachmentCount: 1 });
    expect(clearSendError).not.toHaveBeenCalled();
    rerender({ sendError: "too large", attachmentCount: 0 });
    expect(clearSendError).toHaveBeenCalledTimes(1);
  });

  it("keeps an error raised after the draft was put back", () => {
    const { rerender, clearSendError } = mount({ sendError: null, attachmentCount: 0 });
    rerender({ sendError: "too large", attachmentCount: 2 });
    rerender({ sendError: "too large", attachmentCount: 2 });
    expect(clearSendError).not.toHaveBeenCalled();
  });
});
