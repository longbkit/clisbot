export interface ComposerTextSelection {
  start: number;
  end: number;
}

export interface SlashTriggerEdit {
  text: string;
  selection: ComposerTextSelection;
}

/** The draft is one slash command being typed, so the command list is open (☰ shows ✕). */
export function isSlashCommandDraft(text: string): boolean {
  return /^\/\S*$/.test(text);
}

/**
 * What the commands button does to the draft: the same as typing `/` (docs/features/
 * composer-picker/README.md, "Layout"). An empty draft becomes `/`, which opens the command
 * list; a draft that is only a command being typed (`/`, `/rev`) empties again, which closes
 * it; anywhere else a `/` goes in at the caret, after a space when it would touch a word, which
 * lists the skills as typing it does.
 */
export function resolveSlashTriggerEdit(
  text: string,
  selection: ComposerTextSelection,
): SlashTriggerEdit {
  if (text.trim().length === 0) return { text: "/", selection: { start: 1, end: 1 } };
  if (isSlashCommandDraft(text)) return { text: "", selection: { start: 0, end: 0 } };
  const start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));
  const before = text.slice(0, start);
  const insert = before.length === 0 || /\s$/.test(before) ? "/" : " /";
  const nextText = `${before}${insert}${text.slice(end)}`;
  const caret = start + insert.length;
  return { text: nextText, selection: { start: caret, end: caret } };
}
