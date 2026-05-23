import { TextStyle, Urgency, type Mention, type Style } from "zca-js";
import type {
  MessageInputFormat,
  MessageRenderMode,
} from "../message/message-command.ts";
import { resolveZaloBotMessageContent } from "../zalo-bot/content.ts";

export type ZaloPersonalRenderedMessage = {
  text: string;
  styles?: Style[];
  mentions?: Mention[];
};

type InlineRule = {
  regex: RegExp;
  style: TextStyle | TextStyle[];
};

const INLINE_RULES: InlineRule[] = [
  { regex: /\*\*\*(?=\S)([^\n]*?\S)\*\*\*/g, style: [TextStyle.Bold, TextStyle.Italic] },
  { regex: /\*\*(?=\S)([^\n]*?\S)\*\*/g, style: TextStyle.Bold },
  { regex: /__(?=\S)([^\n]*?\S)__/g, style: TextStyle.Bold },
  { regex: /~~(?=\S)([^\n]*?\S)~~/g, style: TextStyle.StrikeThrough },
  { regex: /(?<!\*)\*(?!\s)([^\n]*?\S)\*(?!\*)/g, style: TextStyle.Italic },
  { regex: /(?<!_)_(?!\s)([^\n]*?\S)_(?!_)/g, style: TextStyle.Italic },
  { regex: /\{(red|orange|yellow|green|big|small|underline)\}([\s\S]+?)\{\/\1\}/g, style: TextStyle.Red },
];

const STYLE_NAME_MAP: Record<string, TextStyle> = {
  bold: TextStyle.Bold,
  italic: TextStyle.Italic,
  underline: TextStyle.Underline,
  strike: TextStyle.StrikeThrough,
  red: TextStyle.Red,
  orange: TextStyle.Orange,
  yellow: TextStyle.Yellow,
  green: TextStyle.Green,
  small: TextStyle.Small,
  big: TextStyle.Big,
  "unordered-list": TextStyle.UnorderedList,
  "ordered-list": TextStyle.OrderedList,
  indent: TextStyle.Indent,
};

const TAG_STYLE_MAP: Record<string, TextStyle> = {
  red: TextStyle.Red,
  orange: TextStyle.Orange,
  yellow: TextStyle.Yellow,
  green: TextStyle.Green,
  big: TextStyle.Big,
  small: TextStyle.Small,
  underline: TextStyle.Underline,
};

export function parseZaloPersonalUrgency(raw?: string) {
  if (!raw || raw === "default" || raw === "0") {
    return Urgency.Default;
  }
  if (raw === "important" || raw === "1") {
    return Urgency.Important;
  }
  if (raw === "urgent" || raw === "2") {
    return Urgency.Urgent;
  }
  throw new Error("--urgency must be default, important, urgent, 0, 1, or 2.");
}

export function parseZaloPersonalStyleSpec(spec: string): Style {
  const [name, startRaw, lenRaw] = spec.split(":");
  const style = name ? STYLE_NAME_MAP[name] : undefined;
  const start = Number.parseInt(startRaw ?? "", 10);
  const len = Number.parseInt(lenRaw ?? "", 10);
  if (!style || !Number.isInteger(start) || !Number.isInteger(len) || start < 0 || len <= 0) {
    throw new Error(`Invalid --style spec: ${spec}. Expected <style>:<offset>:<length>.`);
  }
  return style === TextStyle.Indent
    ? { start, len, st: style, indentSize: 1 }
    : { start, len, st: style as Exclude<TextStyle, TextStyle.Indent> };
}

export function parseZaloPersonalMentionSpec(spec: string): Mention {
  const [uid, posRaw, lenRaw] = spec.split(":");
  const pos = Number.parseInt(posRaw ?? "", 10);
  const len = Number.parseInt(lenRaw ?? "", 10);
  if (!uid?.trim() || !Number.isInteger(pos) || !Number.isInteger(len) || pos < 0 || len <= 0) {
    throw new Error(`Invalid --mention spec: ${spec}. Expected <uid>:<offset>:<length>.`);
  }
  return { uid: uid.trim(), pos, len };
}

export function renderZaloPersonalMessage(params: {
  text: string;
  inputFormat?: MessageInputFormat;
  renderMode?: MessageRenderMode;
  extraStyles?: Style[];
  extraMentions?: Mention[];
}): ZaloPersonalRenderedMessage {
  const inputFormat = params.inputFormat ?? "md";
  const renderMode = params.renderMode ?? "native";
  const base = renderMode === "native" && inputFormat === "md"
    ? renderMarkdownToZalo(params.text)
    : {
        text: resolveZaloBotMessageContent({
          text: params.text,
          inputFormat,
          renderMode,
        }).text,
      };
  const withMentions = extractMentionPlaceholders(base.text, base.styles ?? []);
  const styles = [...(withMentions.styles ?? []), ...(params.extraStyles ?? [])];
  const mentions = [...(withMentions.mentions ?? []), ...(params.extraMentions ?? [])];
  return {
    text: withMentions.text,
    ...(styles.length > 0 ? { styles } : {}),
    ...(mentions.length > 0 ? { mentions } : {}),
  };
}

function renderMarkdownToZalo(input: string): ZaloPersonalRenderedMessage {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  let text = "";
  const styles: Style[] = [];
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    const start = text.length;
    const rendered = inFence ? { text: line.replace(/^ {1,4}/, ""), styles: [] } : renderMarkdownLine(line);
    text += (text ? "\n" : "") + rendered.text;
    for (const style of rendered.styles) {
      styles.push({ ...style, start: style.start + start + (start > 0 ? 1 : 0) } as Style);
    }
  }
  return { text, styles };
}

function renderMarkdownLine(line: string): { text: string; styles: Style[] } {
  const styles: Style[] = [];
  const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
  const unordered = line.match(/^(\s*)[-*+]\s+(.+)$/);
  const ordered = line.match(/^(\s*)\d+\.\s+(.+)$/);
  let text = heading?.[2] ?? unordered?.[2] ?? ordered?.[2] ?? line.replace(/^\s*>\s?/, "");
  const indent = Math.min(5, Math.floor(((unordered?.[1] ?? ordered?.[1] ?? "").length) / 2));
  text = renderInlineMarkdown(text, styles);
  if (heading) {
    styles.push({ start: 0, len: text.length, st: TextStyle.Bold });
    if (heading[1]!.length === 1) {
      styles.push({ start: 0, len: text.length, st: TextStyle.Big });
    }
  }
  if (unordered) {
    styles.push({ start: 0, len: text.length, st: TextStyle.UnorderedList });
  }
  if (ordered) {
    styles.push({ start: 0, len: text.length, st: TextStyle.OrderedList });
  }
  if (indent > 0) {
    styles.push({ start: 0, len: text.length, st: TextStyle.Indent, indentSize: indent });
  }
  return { text, styles };
}

function renderInlineMarkdown(input: string, styles: Style[]) {
  const tokens: Array<{ start: number; end: number; text: string; styles: TextStyle[] }> = [];
  for (const rule of INLINE_RULES) {
    for (const match of input.matchAll(rule.regex)) {
      const markerText = match[2] ?? match[1] ?? "";
      const style = resolveRuleStyle(rule, match);
      tokens.push({
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        text: markerText,
        styles: Array.isArray(style) ? style : [style],
      });
    }
  }
  tokens.sort((a, b) => a.start - b.start || b.end - a.end);
  let cursor = 0;
  let output = "";
  for (const token of tokens) {
    if (token.start < cursor) {
      continue;
    }
    output += input.slice(cursor, token.start);
    const start = output.length;
    output += token.text;
    for (const style of token.styles) {
      styles.push({ start, len: token.text.length, st: style as Exclude<TextStyle, TextStyle.Indent> });
    }
    cursor = token.end;
  }
  output += input.slice(cursor);
  return output.replace(/`([^`\n]+)`/g, "`$1`");
}

function resolveRuleStyle(rule: InlineRule, match: RegExpMatchArray) {
  const tag = match[1];
  if (tag && TAG_STYLE_MAP[tag]) {
    return TAG_STYLE_MAP[tag];
  }
  return rule.style;
}

function extractMentionPlaceholders(text: string, styles: Style[]) {
  const mentions: Mention[] = [];
  let output = "";
  let cursor = 0;
  const regex = /<@([^|>]+)\|([^>]+)>/g;
  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    output += text.slice(cursor, start);
    const visible = `@${match[2]}`;
    const pos = output.length;
    output += visible;
    mentions.push({ uid: match[1]!, pos, len: visible.length });
    cursor = start + match[0].length;
  }
  output += text.slice(cursor);
  if (mentions.length === 0) {
    return { text, styles, mentions };
  }
  return { text: output, styles: shiftStylesForMentions(text, styles), mentions };
}

function shiftStylesForMentions(input: string, styles: Style[]) {
  return styles.map((style) => {
    let delta = 0;
    for (const match of input.matchAll(/<@([^|>]+)\|([^>]+)>/g)) {
      if ((match.index ?? 0) >= style.start) {
        continue;
      }
      delta += match[0].length - (`@${match[2]}`).length;
    }
    return { ...style, start: Math.max(0, style.start - delta) } as Style;
  });
}
