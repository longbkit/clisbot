export type ShortcutKey = string;

export type ShortcutOs = "mac" | "non-mac";

/** `symbols` reads `⌘⏎` for tight tooltips; `words` reads `⌘ Enter` for key hints in a footer. */
export type ShortcutLabels = "symbols" | "words";

const WORD_KEYS = new Set(["Enter", "Backspace", "Space"]);

const KEY_DISPLAY: Record<string, string> = {
  Backspace: "⌫",
  Enter: "⏎",
  Esc: "Esc",
  Space: "␣",
  Left: "←",
  Right: "→",
  Up: "↑",
  Down: "↓",
};

function normalizeKey(key: string, labels: ShortcutLabels): string {
  if (!key) return "";
  if (labels === "words" && WORD_KEYS.has(key)) return key;
  if (KEY_DISPLAY[key]) return KEY_DISPLAY[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function formatShortcut(
  keys: ShortcutKey[],
  os: ShortcutOs,
  labels: ShortcutLabels = "symbols",
): string {
  const normalized = keys.map((k) => (typeof k === "string" ? k : String(k)));

  if (os === "mac") {
    const order = ["ctrl", "alt", "shift", "mod", "meta"];
    const symbols: Record<string, string> = {
      mod: "⌘",
      shift: "⇧",
      alt: "⌥",
      ctrl: "⌃",
      meta: "⌘",
    };

    const modifierSet = new Set(normalized);
    const mods = order.filter((k) => modifierSet.has(k)).map((k) => symbols[k] ?? "");
    const main = normalized
      .filter((k) => !order.includes(k))
      .map((k) => normalizeKey(k, labels))
      .join("");
    const separator = labels === "words" && mods.length > 0 && main.length > 1 ? " " : "";
    return `${mods.join("")}${separator}${main}`;
  }

  const modifierLabels: Record<string, string> = {
    mod: "Ctrl",
    shift: "Shift",
    alt: "Alt",
    ctrl: "Ctrl",
    meta: "Win",
  };
  return normalized
    .map((k) => modifierLabels[k] ?? normalizeKey(k, labels))
    .filter(Boolean)
    .join("+");
}
