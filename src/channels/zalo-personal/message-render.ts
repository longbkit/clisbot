import { TextStyle, Urgency, type Mention, type Style } from "zca-js";
import type {
  MessageInputFormat,
  MessageRenderMode,
} from "../message/message-command.ts";
import { resolveZaloBotMessageContent } from "../zalo-bot/content.ts";
import { renderZaloPersonalMarkdown } from "./markdown-render.ts";

export type ZaloPersonalRenderedMessage = {
  text: string;
  styles?: Style[];
  mentions?: Mention[];
};

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
  const base: ZaloPersonalRenderedMessage = renderMode === "native" && inputFormat === "md"
    ? renderZaloPersonalMarkdown(params.text)
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

function extractMentionPlaceholders(text: string, styles: Style[]) {
  const mentions: Mention[] = [];
  const replacements: Array<{ sourceStart: number; sourceEnd: number; outputStart: number; outputEnd: number }> = [];
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
    const sourceEnd = start + match[0].length;
    replacements.push({ sourceStart: start, sourceEnd, outputStart: pos, outputEnd: pos + visible.length });
    cursor = sourceEnd;
  }
  output += text.slice(cursor);
  if (mentions.length === 0) {
    return { text, styles, mentions };
  }
  return { text: output, styles: remapStylesForMentions(styles, replacements), mentions };
}

function remapStylesForMentions(
  styles: Style[],
  replacements: Array<{ sourceStart: number; sourceEnd: number; outputStart: number; outputEnd: number }>,
) {
  return styles.map((style) => {
    const start = mapMentionOffset(style.start, replacements, "start");
    const end = mapMentionOffset(style.start + style.len, replacements, "end");
    return { ...style, start, len: Math.max(0, end - start) } as Style;
  }).filter((style) => style.len > 0);
}

function mapMentionOffset(
  offset: number,
  replacements: Array<{ sourceStart: number; sourceEnd: number; outputStart: number; outputEnd: number }>,
  boundary: "start" | "end",
) {
  let delta = 0;
  for (const replacement of replacements) {
    const sourceLen = replacement.sourceEnd - replacement.sourceStart;
    const outputLen = replacement.outputEnd - replacement.outputStart;
    if (offset < replacement.sourceStart) break;
    if (offset === replacement.sourceStart) {
      return replacement.outputStart;
    }
    if (offset <= replacement.sourceEnd) {
      return replacement.outputEnd;
    }
    delta += sourceLen - outputLen;
  }
  return Math.max(0, offset - delta);
}
