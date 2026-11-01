export interface ComposerTextSelection {
  start: number;
  end: number;
}

export interface SlashTriggerEdit {
  text: string;
  selection: ComposerTextSelection;
}

/**
 * What the commands button does to the draft: the same as typing `/` (docs/features/
 * composer-picker/README.md, "Commands"). An empty draft becomes `/`, which opens the command
 * list; a draft that is only `/` empties again, which closes it; anywhere else a `/` goes in at
 * the caret, after a space when it would touch a word, which lists the skills as typing it does.
 */
export function resolveSlashTriggerEdit(
  text: string,
  selection: ComposerTextSelection,
): SlashTriggerEdit {
  if (text.trim().length === 0) return { text: "/", selection: { start: 1, end: 1 } };
  if (text === "/") return { text: "", selection: { start: 0, end: 0 } };
  const start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));
  const before = text.slice(0, start);
  const insert = before.length === 0 || /\s$/.test(before) ? "/" : " /";
  const nextText = `${before}${insert}${text.slice(end)}`;
  const caret = start + insert.length;
  return { text: nextText, selection: { start: caret, end: caret } };
}
