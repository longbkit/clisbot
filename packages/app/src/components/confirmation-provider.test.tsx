// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AdaptiveModalSheetProps } from "@/components/adaptive-modal-sheet";
import { ConfirmationProvider, useConfirmation } from "./confirmation-provider";
import { confirmDialog } from "@/utils/confirm-dialog";

const adapter = vi.hoisted(() => ({ sheets: [] as AdaptiveModalSheetProps[] }));
// Preserve the shared sheet's close/dismiss contract; native presentation is owned by the sheet.
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: (props: AdaptiveModalSheetProps) => {
    adapter.sheets.push(props);
    if (!props.visible) return null;
    return (
      <div role="dialog" aria-label={props.header.title}>
        <button type="button" onClick={props.onClose}>
          Close sheet
        </button>
        {props.children}
        {props.footer}
      </div>
    );
  },
}));

let confirm: ReturnType<typeof useConfirmation>;
const input = {
  title: "Remove Channel?",
  message: "Its Routes will stop receiving messages.",
};

function Consumer() {
  confirm = useConfirmation();
  return null;
}

function Surface({ consumer = true }: { consumer?: boolean }) {
  return <ConfirmationProvider>{consumer ? <Consumer /> : null}</ConfirmationProvider>;
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  adapter.sheets.length = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function request(options = input) {
  let result!: Promise<boolean>;
  act(() => {
    result = confirm(options);
  });
  return result;
}

it("shows the requested app confirmation and resolves Cancel without authorizing", async () => {
  render(<Surface />);
  const result = request();
  expect(screen.getByRole("dialog", { name: input.title })).toBeDefined();
  expect(screen.getByText(input.message)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await expect(result).resolves.toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("uses explicit labels and only authorizes after the confirm action", async () => {
  render(<Surface />);
  let result!: Promise<boolean>;
  act(() => {
    result = confirm({
      ...input,
      confirmLabel: "Remove",
      cancelLabel: "Keep",
      destructive: true,
    });
  });
  expect(screen.getByRole("button", { name: "Keep" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await expect(result).resolves.toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("renders a structured body without duplicating fallback prose and clears it on the next request", async () => {
  render(<Surface />);
  let result!: Promise<boolean>;
  act(() => {
    result = confirm({
      title: "Send test message?",
      message: "Plain confirmation fallback",
      body: <div data-testid="preview-body">Exact provider message</div>,
    });
  });
  expect(screen.getByTestId("preview-body").textContent).toBe("Exact provider message");
  expect(adapter.sheets.at(-1)?.snapPoints).toEqual(["65%", "85%"]);
  expect(screen.queryByText("Plain confirmation fallback")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await expect(result).resolves.toBe(false);
  const next = request();
  expect(adapter.sheets.at(-1)?.snapPoints).toEqual(["40%", "65%"]);
  expect(screen.queryByTestId("preview-body")).toBeNull();
  expect(screen.getByText(input.message)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await expect(next).resolves.toBe(false);
});

it.each(["onClose", "onDismiss"] as const)(
  "declines when the shared modal invokes %s",
  async (event) => {
    render(<Surface />);
    const result = request();
    act(() => adapter.sheets.at(-1)?.[event]?.());
    await expect(result).resolves.toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it("declines duplicate requests while keeping the original confirmation pending", async () => {
  render(<Surface />);
  const first = request();
  const second = request({
    title: "Another request",
    message: "Must not replace the first.",
  });
  await expect(second).resolves.toBe(false);
  expect(screen.getByRole("dialog", { name: input.title })).toBeDefined();
  const sheet = adapter.sheets.at(-1)!;
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  act(() => {
    sheet.onClose();
    sheet.onDismiss?.();
  });
  await expect(first).resolves.toBe(true);
});

it("supports consecutive confirmations without an old dismissal canceling the next", async () => {
  render(<Surface />);
  const first = request();
  const firstSheet = adapter.sheets.at(-1)!;
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await expect(first).resolves.toBe(true);
  const nextInput = {
    title: "Remove unused Connection?",
    message: "No Channels use it.",
  };
  const second = request(nextInput);
  act(() => firstSheet.onDismiss?.());
  expect(screen.getByRole("dialog", { name: nextInput.title })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await expect(second).resolves.toBe(false);
});

it("declines when the requesting form leaves even if its screen remains mounted", async () => {
  const view = render(<Surface />);
  const result = request();
  const oldConfirm = confirm;
  view.rerender(<Surface consumer={false} />);
  await expect(result).resolves.toBe(false);
  await expect(oldConfirm(input)).resolves.toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(<Surface />);
  const next = request();
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await expect(next).resolves.toBe(true);
});

it("declines a pending confirmation when the screen unmounts", async () => {
  const view = render(<Surface />);
  const result = request();
  view.unmount();
  await expect(result).resolves.toBe(false);
});

it("declines imperative confirmation when the route scope changes", async () => {
  const view = render(
    <ConfirmationProvider webBackend scopeKey="/settings/access">
      {null}
    </ConfirmationProvider>,
  );
  let result!: Promise<boolean>;
  await act(async () => {
    result = confirmDialog(input);
  });
  expect(screen.getByRole("dialog", { name: input.title })).toBeDefined();
  view.rerender(
    <ConfirmationProvider webBackend scopeKey="/settings/hosts">
      {null}
    </ConfirmationProvider>,
  );
  await expect(result).resolves.toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
  let next!: Promise<boolean>;
  await act(async () => {
    next = confirmDialog(input);
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await expect(next).resolves.toBe(true);
});
