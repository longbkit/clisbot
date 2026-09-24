// Fusion-owned: compile forwarded Markdown through the existing presentation sender.
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import type { MessagePresentationBlock } from "@getpaseo/channels-core/plugin-sdk/interactive-runtime";
import { resolveMarkdownTableMode } from "@getpaseo/channels-core/plugin-sdk/markdown-table-runtime";
import {
  getMarkdownTableSource,
  markdownToIRWithMeta,
  type MarkdownTableCell,
} from "@getpaseo/channels-markdown-core/ir";
import { buildSlackDataTableBlock } from "./data-table.js";
import { editSlackRenderedMessage } from "./actions.js";
import type { WebClient } from "./client/web-api.js";
import { normalizeSlackOutboundText } from "./format.js";
import { resolveSlackOutboundPresentationMessages } from "./presentation-outbound.js";
import type { SlackReplyDeliveryMessage } from "./reply-blocks.js";

/** A draft edit must fit one message; larger answers retain the text sender's chunking. */
export async function editSlackMarkdownTableMessage(params: {
  text: string;
  cfg: OpenClawConfig;
  accountId: string;
  client: WebClient;
  token: string;
  channel: string;
  messageId: string;
}): Promise<boolean> {
  const messages = resolveSlackMarkdownTableMessages(params);
  const message = messages.length === 1 ? messages[0] : undefined;
  if (!message?.blocks?.length) return false;
  // All visible content is already in blocks. The edit owner derives its own
  // fallback; passing the send owner's accessibility text duplicates that content.
  await editSlackRenderedMessage(params.channel, params.messageId, "", {
    // The legacy drive client is a structural view of the same Slack WebClient.
    client: params.client as unknown as NonNullable<
      Parameters<typeof editSlackRenderedMessage>[3]
    >["client"],
    token: params.token,
    accountId: params.accountId,
    blocks: message.blocks,
  });
  return true;
}

/** Native tables are opt-out through the existing account/channel markdown.tables setting. */
export function resolveSlackMarkdownTableMessages(params: {
  text: string;
  cfg: OpenClawConfig;
  accountId: string;
}): SlackReplyDeliveryMessage[] {
  const mode = resolveMarkdownTableMode({ ...params, channel: "slack", supportsBlockTables: true });
  if (mode !== "block" || !params.text.includes("|")) return [];
  const tables = collectNativeTables(params.text);
  if (tables.length === 0) return [];
  // Parse the entire document once, with placeholders only for native tables.
  // This preserves reference definitions and quote/list context across tables.
  let prefix = "PASEOSLACKTABLE";
  while (params.text.includes(prefix)) prefix += "X";
  let markdown = "";
  let cursor = 0;
  const markers = tables.map((table, index) => {
    const marker = `${prefix}${index}END`;
    markdown += params.text.slice(cursor, table.start) + marker;
    cursor = table.end;
    return marker;
  });
  markdown += params.text.slice(cursor);
  const rendered = normalizeSlackOutboundText(markdown, { tableMode: "code" });
  const blocks: MessagePresentationBlock[] = [];
  cursor = 0;
  for (const [index, table] of tables.entries()) {
    const marker = markers[index]!;
    const offset = rendered.indexOf(marker, cursor);
    if (offset < 0) return []; // Keep the original text if a renderer consumed a placeholder.
    if (rendered.indexOf(marker, offset + marker.length) >= 0) return []; // Entity-decoded collision.
    appendRenderedText(blocks, rendered.slice(cursor, offset));
    blocks.push(table.block);
    cursor = offset + marker.length;
  }
  appendRenderedText(blocks, rendered.slice(cursor));
  return resolveSlackOutboundPresentationMessages({ text: "", presentation: { blocks } }).messages;
}

type NativeMarkdownTable = {
  start: number;
  end: number;
  block: Extract<MessagePresentationBlock, { type: "table" }>;
};

function collectNativeTables(markdown: string): NativeMarkdownTable[] {
  const { tables } = markdownToIRWithMeta(markdown, { tableMode: "block" });
  const native: NativeMarkdownTable[] = [];
  for (const table of tables) {
    const source = getMarkdownTableSource(table);
    // Leave contained tables untouched so the whole-document code renderer keeps their context.
    if (!source || source.prefix) continue;
    const block = {
      type: "table" as const,
      caption: table.headers.find((header) => header.trim()) ?? "Table",
      headers: table.headerCells.map(cellText),
      rows: table.rowCells.map((row) => row.map(cellText)),
    };
    if (buildSlackDataTableBlock(block))
      native.push({ start: source.start, end: source.end, block });
  }
  return native;
}

function appendRenderedText(blocks: MessagePresentationBlock[], text: string): void {
  if (text.trim()) blocks.push({ type: "text", text });
}

/** Plain table cells must keep link destinations even when their visible label differs. */
function cellText(cell: MarkdownTableCell): string {
  let text = cell.text;
  for (const link of [...cell.links].reverse()) {
    if (cell.text.slice(link.start, link.end) !== link.href) {
      text = `${text.slice(0, link.end)} (${link.href})${text.slice(link.end)}`;
    }
  }
  return text;
}
