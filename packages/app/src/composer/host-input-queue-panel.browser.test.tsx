import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { HostInputQueuePanel } from "./host-input-queue-panel";
import { i18n } from "@/i18n/i18next";
const DEFAULT_VIEW: React.ComponentProps<typeof HostInputQueuePanel>["view"] = {
  items: [{ id: "one", text: "Preview", attachments: [{}], state: "queued" }],
};
let root: Root;
let container: HTMLDivElement;
beforeAll(async () => {
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("en");
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});
function mount(overrides: Partial<React.ComponentProps<typeof HostInputQueuePanel>> = {}) {
  const actions = {
    edit: vi.fn(),
    sendNow: vi.fn(),
    steer: vi.fn(),
    remove: vi.fn(),
    save: vi.fn(),
    move: vi.fn(),
    cancel: vi.fn(),
    enqueueNew: vi.fn(),
  };
  container = document.createElement("div");
  container.style.width = "358px";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <HostInputQueuePanel
        {...actions}
        pending={false}
        editor={null}
        error={null}
        view={DEFAULT_VIEW}
        {...overrides}
      />,
    ),
  );
  return actions;
}
function button(label: string) {
  return document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
}
const click = (element: Element) => act(() => (element as HTMLElement).click());
test("compact row exposes accessible icon actions and original named send choices without accidental admission", async () => {
  const actions = mount();
  expect(container.textContent).not.toContain("Client queue");
  expect(container.querySelector('[aria-label="Attachments (1)"]')).not.toBeNull();
  for (const label of ["Edit", "Send actions", "Delete"]) {
    const rect = button(label).getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.height).toBeGreaterThanOrEqual(44);
  }
  click(button("Edit"));
  expect(actions.edit).toHaveBeenCalledExactlyOnceWith("one");
  click(button("Delete"));
  expect(actions.remove).toHaveBeenCalledExactlyOnceWith("one");
  click(button("Send actions"));
  expect(actions.sendNow).not.toHaveBeenCalled();
  expect(actions.steer).not.toHaveBeenCalled();
  const choice = [...document.querySelectorAll('[role="menuitem"]')].find((e) =>
    e.textContent?.includes("Steer this send"),
  )!;
  expect(choice).toBeDefined();
  click(choice);
  await vi.waitFor(() => expect(actions.steer).toHaveBeenCalledExactlyOnceWith("one"));
  expect(actions.sendNow).not.toHaveBeenCalled();
  click(button("Send actions"));
  await vi.waitFor(() => expect(document.querySelector('[role="menuitem"]')).not.toBeNull());
  const interrupt = [...document.querySelectorAll('[role="menuitem"]')].find((e) =>
    e.textContent?.includes("Interrupt and send"),
  )!;
  click(interrupt);
  await vi.waitFor(() => expect(actions.sendNow).toHaveBeenCalledExactlyOnceWith("one"));
  expect(actions.steer).toHaveBeenCalledTimes(1);
});
test("manual badge explains on demand, direct Send remains named; disabled/review/sending and stale editor guards remain", async () => {
  const actions = mount({
    notice: "Group explanation",
    hideSteer: true,
    sendNowLabel: "Send message",
  });
  expect(document.body.textContent).not.toContain("Group explanation");
  click(button("Manual"));
  await vi.waitFor(() => expect(document.body.textContent).toContain("Group explanation"));
  click(button("Send message"));
  expect(actions.sendNow).toHaveBeenCalledExactlyOnceWith("one");
});
test("pending and nonqueued rows cannot send; stale Save/Move remain disabled", () => {
  const actions = mount({
    pending: true,
    editor: { stale: true },
    view: {
      items: [
        { id: "one", text: "Queued", state: "queued" },
        { id: "two", text: "Sending", state: "sending" },
        { id: "three", text: "Review", state: "needs_review", reason: "Unknown ACK" },
      ],
    },
  });
  expect(button("Edit").getAttribute("aria-disabled")).toBe("true");
  expect(button("Send actions").getAttribute("aria-disabled")).toBe("true");
  const sending = container.querySelector('[data-testid="host-queue-two"]')!;
  const review = container.querySelector('[data-testid="host-queue-three"]')!;
  expect(sending.querySelector('[role="button"]')).toBeNull();
  expect(review.querySelector('[aria-label="Send actions"]')).toBeNull();
  const save = [...container.querySelectorAll('button,[role="button"]')].find(
    (e) => e.textContent === "Save changes",
  ) as HTMLButtonElement;
  const move = [...container.querySelectorAll('button,[role="button"]')].find(
    (e) => e.textContent === "Move to end",
  ) as HTMLButtonElement;
  expect(save.getAttribute("aria-disabled")).toBe("true");
  expect(move.getAttribute("aria-disabled")).toBe("true");
  expect(actions.save).not.toHaveBeenCalled();
});

test("localized manual badge keeps all icon targets inside a compact row", async () => {
  await i18n.changeLanguage("vi");
  try {
    mount({ notice: "Giải thích khi chạm", hideSteer: true, sendNowLabel: "Gửi tin nhắn" });
    const row = container.querySelector('[data-testid="host-queue-one"]')!.getBoundingClientRect();
    expect(row.height).toBeLessThanOrEqual(56);
    for (const target of container.querySelectorAll('[role="button"]')) {
      const box = target.getBoundingClientRect();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.right).toBeLessThanOrEqual(row.right + 1);
    }
    expect(button("Gửi thủ công")).not.toBeNull();
  } finally {
    await i18n.changeLanguage("en");
  }
});
