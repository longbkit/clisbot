import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { HostInputQueuePanel } from "./host-input-queue-panel";
import { i18n } from "@/i18n/i18next";

// The phone's ⋯ menu opens a bottom sheet, which needs the app's sheet providers; the stub keeps
// the row's own part under test: which items ⋯ offers and what each one calls.
vi.mock("@/components/ui/dropdown-menu", async (importOriginal) => {
  const { createContext, useContext, useMemo, useReducer } = await import("react");
  interface Props {
    children?: React.ReactNode;
    testID?: string;
    accessibilityLabel?: string;
    onSelect?: () => void;
  }
  const Open = createContext({ open: false, toggle: () => {} });
  function DropdownMenu({ children }: Props) {
    const [open, toggle] = useReducer((was: boolean) => !was, false);
    const value = useMemo(() => ({ open, toggle }), [open]);
    return <Open.Provider value={value}>{children}</Open.Provider>;
  }
  function DropdownMenuTrigger({ children, testID, accessibilityLabel }: Props) {
    const { toggle } = useContext(Open);
    return (
      <button type="button" aria-label={accessibilityLabel} data-testid={testID} onClick={toggle}>
        {children}
      </button>
    );
  }
  function DropdownMenuContent({ children }: Props) {
    return useContext(Open).open ? <div>{children}</div> : null;
  }
  function DropdownMenuItem({ children, testID, onSelect }: Props) {
    return (
      <button type="button" data-testid={testID} onClick={onSelect}>
        {children}
      </button>
    );
  }
  return {
    ...(await importOriginal<typeof import("@/components/ui/dropdown-menu")>()),
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
  };
});
const layout = vi.hoisted(() => ({ compact: false }));
vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => layout.compact,
}));

// A 1×1 PNG: an image a queued message carries.
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
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
function button(label: string) {
  return document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
}
const click = (element: Element) => act(() => (element as HTMLElement).click());
function row(id = "one") {
  return container.querySelector(`[data-testid="host-queue-${id}"]`) as HTMLElement;
}
function hover(element: Element) {
  act(() => {
    element.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
}

test.each([undefined, "Send message"])(
  "desktop shows only Send; hovering lays View, Edit and Delete over the text; client label=%s",
  (sendNowLabel) => {
    const actions = mount({ sendNowLabel });
    expect(container.querySelector('[aria-label="Attachments (1)"]')).not.toBeNull();
    // Without manual delivery the queue steers; the label names it either way.
    const send = "Steer this send";
    expect(button(send)).not.toBeNull();
    for (const label of ["Edit", "Delete", "View"]) expect(button(label)).toBeNull();
    const text = row().querySelector('[data-testid="host-queue-text"]')!;
    const before = text.getBoundingClientRect();
    hover(row());
    for (const label of ["Edit", "Delete", "View"]) {
      const rect = button(label).getBoundingClientRect();
      expect(rect.width).toBeGreaterThanOrEqual(44);
    }
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
  },
);

test("reads at the normal text size, larger than the row's small hints", () => {
  mount();
  const size = (element: Element) => parseFloat(getComputedStyle(element).fontSize);
  const text = row().querySelector('[data-testid="host-queue-text-label"]')!;
  const hint = row().querySelector('[aria-label="Attachments (1)"] div')!;
  expect(size(text)).toBeGreaterThan(size(hint));
});

test("View expands the full message and its images; an image opens large", async () => {
  mount({
    view: {
      items: [
        {
          id: "one",
          text: "A long queued message ".repeat(12),
          images: [{ data: PIXEL, mimeType: "image/png" }],
          state: "queued",
        },
      ],
    },
  });
  expect(row().querySelector('[data-testid="host-queue-images"]')).toBeNull();
  hover(row());
  click(button("View"));
  const image = row().querySelector('[data-testid="host-queue-image"]')!;
  expect(image).not.toBeNull();
  expect(row().querySelector("img")?.getAttribute("src")).toContain("data:image/png;base64");
  click(image);
  await vi.waitFor(() =>
    expect(document.querySelectorAll(`img[src*="${PIXEL.slice(0, 16)}"]`).length).toBeGreaterThan(
      1,
    ),
  );
});

test("a phone shows Send and ⋯; ⋯ offers View, Edit and Delete", async () => {
  layout.compact = true;
  const actions = mount();
  expect(button("Steer this send")).not.toBeNull();
  const more = row().querySelector('[data-testid="host-queue-more"]')!;
  expect(more).not.toBeNull();
  expect(button("Edit")).toBeNull();
  click(more);
  expect(document.querySelector('[data-testid="host-queue-edit"]')).not.toBeNull();
  for (const id of ["host-queue-view", "host-queue-delete"])
    expect(document.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
  click(document.querySelector('[data-testid="host-queue-edit"]')!);
  expect(actions.edit).toHaveBeenCalledExactlyOnceWith("one");
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
    for (const target of container.querySelectorAll('[role="button"]')) {
      const rect = target.getBoundingClientRect();
      expect(rect.right).toBeLessThanOrEqual(box.right + 1);
    }
    expect(button("Gửi thủ công")).not.toBeNull();
  } finally {
    await i18n.changeLanguage("en");
  }
});
