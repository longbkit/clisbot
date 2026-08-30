// COMPAT(clisbot-control-plane): Telegram channel format — HTML entity
// decoding + `&`/`<`/`>` escape (C5) — verbatim port of openclaw-private
// `extensions/telegram/src/format-html.ts` (the entity half; the
// structural-line-break tag set belongs to the transcript-protection pass,
// which the in-repo vertical does not run, so it is omitted here).

// Escape `&`, `<`, `>` for Bot API HTML mode. Lives here (the HTML entity /
// format leaf) rather than `format.ts` so both `format.ts` and
// `format-sanitize.ts` can import it without a cycle (`format.ts` already
// imports `renderSupportedTelegramHtml` from `format-sanitize.ts`).
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const TELEGRAM_HTML_ENTITY_PATTERN = /&(#[xX][0-9A-Fa-f]+|#\d+|amp|lt|gt|quot|apos);/g;

function isValidTelegramHtmlEntityCodePoint(codePoint: number): boolean {
  return (
    Number.isInteger(codePoint) &&
    codePoint >= 0 &&
    codePoint <= 0x10ffff &&
    !(codePoint >= 0xd800 && codePoint <= 0xdfff)
  );
}

function decodeTelegramHtmlEntity(entity: string, fallback: string): string {
  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    const codePoint = Number.parseInt(entity.slice(2), 16);
    return isValidTelegramHtmlEntityCodePoint(codePoint)
      ? String.fromCodePoint(codePoint)
      : fallback;
  }
  if (entity.startsWith("#")) {
    const codePoint = Number.parseInt(entity.slice(1), 10);
    return isValidTelegramHtmlEntityCodePoint(codePoint)
      ? String.fromCodePoint(codePoint)
      : fallback;
  }
  switch (entity) {
    case "amp":
      return "&";
    case "lt":
      return "<";
    case "gt":
      return ">";
    case "quot":
      return '"';
    case "apos":
      return "'";
    default:
      return fallback;
  }
}

export function decodeTelegramHtmlEntities(text: string): string {
  return text.replace(TELEGRAM_HTML_ENTITY_PATTERN, (match, entity: string) =>
    decodeTelegramHtmlEntity(entity, match),
  );
}

export function findTelegramHtmlEntityEnd(text: string, start: number): number {
  if (text[start] !== "&") {
    return -1;
  }
  let index = start + 1;
  if (index >= text.length) {
    return -1;
  }
  if (text[index] === "#") {
    index += 1;
    if (index >= text.length) {
      return -1;
    }
    const isHex = text[index] === "x" || text[index] === "X";
    if (isHex) {
      index += 1;
      const hexStart = index;
      while (/[0-9A-Fa-f]/.test(text[index] ?? "")) {
        index += 1;
      }
      if (index === hexStart) {
        return -1;
      }
    } else {
      const digitStart = index;
      while (/[0-9]/.test(text[index] ?? "")) {
        index += 1;
      }
      if (index === digitStart) {
        return -1;
      }
    }
  } else {
    const nameStart = index;
    while (/[A-Za-z0-9]/.test(text[index] ?? "")) {
      index += 1;
    }
    if (index === nameStart) {
      return -1;
    }
  }
  return text[index] === ";" ? index : -1;
}
