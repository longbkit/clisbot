import type { ShortcutOs } from "@/utils/format-shortcut";

export interface PickerKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type PickerKeyAction =
  | { kind: "pick"; index: number }
  | { kind: "move"; key: "ArrowDown" | "ArrowUp" }
  | { kind: "enter" };

/** ⌘1…⌘9 (Ctrl on Windows and Linux) pick a row; the arrows move; Enter picks. */
export function resolvePickerKey(event: PickerKeyEvent, os: ShortcutOs): PickerKeyAction | null {
  const mod = os === "mac" ? event.metaKey : event.ctrlKey;
  const otherMod = os === "mac" ? event.ctrlKey : event.metaKey;
  if (mod && !otherMod && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
    return { kind: "pick", index: Number(event.key) - 1 };
  }
  if (mod || otherMod || event.altKey || event.shiftKey) return null;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") return { kind: "move", key: event.key };
  return event.key === "Enter" ? { kind: "enter" } : null;
}
