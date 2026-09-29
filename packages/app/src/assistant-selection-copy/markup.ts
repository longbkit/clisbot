export const MARKDOWN_COPY_TAG_ATTRIBUTE = "data-clisbot-markdown-tag";
export const MARKDOWN_COPY_IGNORE_ATTRIBUTE = "data-clisbot-markdown-ignore";
export const MARKDOWN_COPY_LIST_MARKER_ATTRIBUTE = "data-clisbot-markdown-list-marker";
export const MARKDOWN_COPY_UNWRAP_ATTRIBUTE = "data-clisbot-markdown-unwrap";
export const MARKDOWN_COPY_LIST_START_ATTRIBUTE = "data-clisbot-markdown-list-start";
export const MARKDOWN_COPY_LANGUAGE_ATTRIBUTE = "data-clisbot-markdown-language";
export const MARKDOWN_COPY_ALIGN_ATTRIBUTE = "data-clisbot-markdown-align";

/**
 * Trailing line breaks, with any indentation that followed the last one.
 *
 * Both ways of copying code strip these, for the same reason: pasting a trailing
 * newline into a terminal runs the last line. A fence body always ends in one, and
 * ends in several when the author left blank lines before the closing fence; a
 * selection picks one up whenever it overshoots the end of a rendered line.
 */
export const TRAILING_CODE_LINE_BREAKS = /(\r?\n[ \t]*)+$/;

export const markdownCopyDataSet = {
  blockquote: { clisbotMarkdownTag: "blockquote" },
  br: { clisbotMarkdownTag: "br" },
  code: { clisbotMarkdownTag: "code" },
  h1: { clisbotMarkdownTag: "h1" },
  h2: { clisbotMarkdownTag: "h2" },
  h3: { clisbotMarkdownTag: "h3" },
  h4: { clisbotMarkdownTag: "h4" },
  h5: { clisbotMarkdownTag: "h5" },
  h6: { clisbotMarkdownTag: "h6" },
  hr: { clisbotMarkdownTag: "hr" },
  ignore: { clisbotMarkdownIgnore: "true" },
  li: { clisbotMarkdownTag: "li" },
  listMarker: { clisbotMarkdownIgnore: "true", clisbotMarkdownListMarker: "true" },
  ol: { clisbotMarkdownTag: "ol" },
  p: { clisbotMarkdownTag: "p" },
  pre: { clisbotMarkdownTag: "pre" },
  s: { clisbotMarkdownTag: "s" },
  strong: { clisbotMarkdownTag: "strong" },
  em: { clisbotMarkdownTag: "em" },
  table: { clisbotMarkdownTag: "table" },
  tbody: { clisbotMarkdownTag: "tbody" },
  td: { clisbotMarkdownTag: "td" },
  th: { clisbotMarkdownTag: "th" },
  thead: { clisbotMarkdownTag: "thead" },
  tr: { clisbotMarkdownTag: "tr" },
  ul: { clisbotMarkdownTag: "ul" },
  unwrap: { clisbotMarkdownUnwrap: "true" },
} as const;

export type MarkdownCopyInlineTag = "br" | "code" | "em" | "s" | "strong";

export function markdownCopyOrderedListDataSet(start: unknown) {
  return {
    ...markdownCopyDataSet.ol,
    clisbotMarkdownListStart: String(start ?? 1),
  } as const;
}

export function markdownCopyCodeBlockDataSet(language: string | null | undefined) {
  const fenceLanguage = language?.trim().split(/\s+/)[0];
  return {
    ...markdownCopyDataSet.pre,
    ...(fenceLanguage ? { clisbotMarkdownLanguage: fenceLanguage } : {}),
  } as const;
}

export function markdownCopyTableCellDataSet(tag: "td" | "th", style: unknown) {
  const alignment =
    typeof style === "string"
      ? style.match(/(?:^|;)\s*text-align\s*:\s*(left|right|center)/i)?.[1]
      : null;
  return {
    ...markdownCopyDataSet[tag],
    ...(alignment ? { clisbotMarkdownAlign: alignment.toLowerCase() } : {}),
  } as const;
}
