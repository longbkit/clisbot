import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { HostInputQueuePanel } from "./host-input-queue-panel";
import { i18n } from "@/i18n/i18next";

const layout = vi.hoisted(() => ({ compact: false }));
vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => layout.compact,
}));
// A compact menu opens as a bottom sheet, which needs the app's sheet providers. Only that
// presentation is swapped: every menu here opens as the real popover, with its real items.
vi.mock("@/components/ui/menu/menu-context", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/ui/menu/menu-context")>();
  return {
    ...original,
    useMenuState: (...args: Parameters<typeof original.useMenuState>) => ({
      ...original.useMenuState(...args),
      presentation: "popover" as const,
    }),
  };
});

// A keyboard focus opens each action's tooltip, and the tooltip's web fade cannot run in this
// harness (reanimated throws on it); tooltips appear and close without it.
vi.mock("react-native-reanimated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-native-reanimated")>()),
  FadeIn: { duration: () => undefined },
  FadeOut: { duration: () => undefined },
}));

// A 1×1 PNG: an image a queued message carries.
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const FILE = {
  type: "uploaded_file",
  id: "file",
  fileName: "notes.txt",
  mimeType: "text/plain",
  size: 1,
  path: "/notes.txt",
} as const;
const DEFAULT_VIEW: React.ComponentProps<typeof HostInputQueuePanel>["view"] = {
  items: [{ id: "one", text: "Preview", attachments: [FILE], state: "queued" }],
};
const LONG = "A long queued message ".repeat(12).trim();
let root: Root;
let container: HTMLDivElement;
beforeAll(async () => {
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("en");
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  layout.compact = false;
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
function one(text: string, extra: Partial<{ images: { data: string; mimeType: string }[] }> = {}) {
  return { items: [{ id: "one", text, state: "queued" as const, ...extra }] };
}
function button(label: string) {
  return document.querySelector(`[aria-label="${label}"]`) as HTMLElement;
}
const click = (element: Element) => act(() => (element as HTMLElement).click());
function row(id = "one") {
  return container.querySelector(`[data-testid="host-queue-${id}"]`) as HTMLElement;
}
function find(id: string, scope: ParentNode = row()) {
  return scope.querySelector(`[data-testid="${id}"]`) as HTMLElement;
}
function hover(element: Element) {
  act(() => {
    element.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
}
function shown(element: Element) {
  const style = getComputedStyle(element);
  return style.opacity !== "0" && style.pointerEvents !== "none";
}
function expectTarget(element: Element) {
  const rect = element.getBoundingClientRect();
  expect(rect.width).toBeGreaterThanOrEqual(44);
  expect(rect.height).toBeGreaterThanOrEqual(44);
}

test.each([undefined, "Send message"])(
  "desktop shows only Send; hovering lays View, Edit and Delete over the text; client label=%s",
  (sendNowLabel) => {
    const actions = mount({ sendNowLabel });
    expect(container.textContent).not.toContain("Client queue");
    expect(container.querySelector('[aria-label="Attachments (1)"]')).not.toBeNull();
    // Without manual delivery the queue steers; the label names it either way.
    const send = "Steer this send";
    expectTarget(button(send));
    expect(shown(find("host-queue-hover-actions"))).toBe(false);
    const text = find("host-queue-text");
    expect(text.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    const before = text.getBoundingClientRect();
    hover(row());
    expect(shown(find("host-queue-hover-actions"))).toBe(true);
    for (const label of ["Edit", "Delete", "View", send]) expectTarget(button(label));
    // An overlay: the text keeps its box, nothing reflows.
    const after = text.getBoundingClientRect();
    expect(after.width).toBe(before.width);
    expect(after.left).toBe(before.left);
    click(button("Edit"));
    expect(actions.edit).toHaveBeenCalledExactlyOnceWith("one");
    click(button("Delete"));
    expect(actions.remove).toHaveBeenCalledExactlyOnceWith("one");
    click(button(send));
    expect(actions.steer).toHaveBeenCalledExactlyOnceWith("one");
    expect(actions.sendNow).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menuitem"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Interrupt and send");
  },
);

test("the keyboard reaches View, Edit and Delete, and focus shows them", async () => {
  mount({ view: one("Preview") });
  const overlay = find("host-queue-hover-actions");
  expect(shown(overlay)).toBe(false);
  const reached: (string | null)[] = [];
  for (let step = 0; step < 4; step += 1) {
    await userEvent.tab();
    reached.push(document.activeElement?.getAttribute("aria-label") ?? null);
    if (document.activeElement?.getAttribute("aria-label") === "Edit")
      expect(shown(overlay)).toBe(true);
  }
  // The text is read as text, not a second View control.
  expect(reached).toEqual(["View", "Edit", "Delete", "Steer this send"]);
});

test("reads at the normal text size, larger than the row's small hints", () => {
  mount();
  const size = (element: Element) => parseFloat(getComputedStyle(element).fontSize);
  const text = find("host-queue-text-label");
  const hint = row().querySelector('[aria-label="Attachments (1)"] div')!;
  expect(size(text)).toBeGreaterThan(size(hint));
});

test("View expands the full message and its images, clear of the actions; an image opens large", async () => {
  mount({ view: one(LONG, { images: [{ data: PIXEL, mimeType: "image/png" }] }) });
  expect(find("host-queue-images")).toBeNull();
  hover(row());
  click(button("View"));
  // Hovered and expanded: the actions sit beside the first line, never over the text.
  const overlay = find("host-queue-hover-actions").getBoundingClientRect();
  const label = find("host-queue-text-label").getBoundingClientRect();
  expect(overlay.height).toBe(44);
  expect(label.height).toBeGreaterThan(overlay.height);
  expect(label.right).toBeLessThanOrEqual(overlay.left);
  // Expanded text can be selected; a press on it does not collapse the row.
  click(find("host-queue-text-label"));
  const image = find("host-queue-image");
  expect(image).not.toBeNull();
  expect(row().querySelector("img")?.getAttribute("src")).toContain("data:image/png;base64");
  click(image);
  await vi.waitFor(() =>
    expect(document.querySelectorAll(`img[src*="${PIXEL.slice(0, 16)}"]`).length).toBeGreaterThan(
      1,
    ),
  );
  click(button("Collapse"));
  expect(find("host-queue-images")).toBeNull();
});

test("a cut-off message shows in full on the first hover", async () => {
  mount({ view: one(LONG) });
  await userEvent.hover(find("host-queue-text-label"));
  await vi.waitFor(() =>
    expect(
      [...document.querySelectorAll("div")].filter((e) => e.textContent === LONG).length,
    ).toBeGreaterThan(2),
  );
});

test("a phone shows Send and ⋯; ⋯ offers View, Edit and Delete", async () => {
  layout.compact = true;
  const actions = mount();
  expectTarget(button("Steer this send"));
  const more = find("host-queue-more");
  expectTarget(more);
  expect(find("host-queue-hover-actions")).toBeNull();
  expect(button("Edit")).toBeNull();
  click(more);
  await vi.waitFor(() =>
    expect(document.querySelector('[data-testid="host-queue-edit"]')).not.toBeNull(),
  );
  for (const id of ["host-queue-view", "host-queue-edit", "host-queue-delete"]) {
    const item = find(id, document);
    expect(item.getAttribute("role")).toBe("menuitem");
  }
  click(find("host-queue-edit", document));
  expect(actions.edit).toHaveBeenCalledExactlyOnceWith("one");
});

test("a phone's ⋯ keeps Edit and Delete disabled while a change is pending", async () => {
  layout.compact = true;
  const actions = mount({ pending: true });
  click(find("host-queue-more"));
  await vi.waitFor(() =>
    expect(document.querySelector('[data-testid="host-queue-edit"]')).not.toBeNull(),
  );
  for (const id of ["host-queue-edit", "host-queue-delete"])
    expect(find(id, document).getAttribute("aria-disabled")).toBe("true");
  expect(find("host-queue-view", document).getAttribute("aria-disabled")).not.toBe("true");
  click(find("host-queue-edit", document));
  click(find("host-queue-delete", document));
  expect(actions.edit).not.toHaveBeenCalled();
  expect(actions.remove).not.toHaveBeenCalled();
});

test("manual badge explains on demand, direct Send remains named", async () => {
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
  expect(button("Steer this send").getAttribute("aria-disabled")).toBe("true");
  click(button("Steer this send"));
  expect(actions.steer).not.toHaveBeenCalled();
  hover(row("one"));
  expect(button("Edit").getAttribute("aria-disabled")).toBe("true");
  expect(row("two").querySelector('[aria-label="Steer this send"]')).toBeNull();
  hover(row("two"));
  expect(row("two").querySelector('[aria-label="Edit"]')).toBeNull();
  expect(row("two").querySelector('[role="button"]')).toBeNull();
  expect(row("three").querySelector('[aria-label="Steer this send"]')).toBeNull();
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
    const box = row().getBoundingClientRect();
    expect(box.height).toBeLessThanOrEqual(56);
    expect(find("host-queue-text").getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    const targets = container.querySelectorAll('[role="button"]');
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      const rect = target.getBoundingClientRect();
      expect(rect.height).toBeGreaterThanOrEqual(44);
      expect(rect.right).toBeLessThanOrEqual(box.right + 1);
    }
    expect(button("Gửi thủ công")).not.toBeNull();
  } finally {
    await i18n.changeLanguage("en");
  }
});
