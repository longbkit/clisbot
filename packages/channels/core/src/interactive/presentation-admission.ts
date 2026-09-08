// Fusion-owned: portable presentation admission (D-W6-02).
//
// `normalizeMessagePresentation` (payload.ts, verbatim upstream — upstream is
// the same at 5d8067a4483) requires a `caption` on a table block and returns
// `undefined` for the block otherwise, while the message tool's schema marks
// `caption` optional (`agents/tools/message-tool-schema.ts`). A model that
// writes a table without a caption therefore gets no block, no fallback text
// and no error: the data disappears between the tool call and the channel.
//
// Admission is the boundary rule: repair what the portable contract can supply
// itself (a table's caption defaults to its first header) and report every
// block the normalizer still refuses, so the caller can tell the model what was
// not delivered. Nothing is dropped silently.
import { normalizeMessagePresentation, type MessagePresentation } from "./payload.js";

/** What admission did with one authored block. */
export interface MessagePresentationBlockNote {
  /** The block's position in the authored `blocks` array. */
  index: number;
  /** The authored `type`, or `"unknown"` when the block declared none. */
  type: string;
  outcome: "repaired" | "rejected";
  reason: string;
}

export interface MessagePresentationAdmission {
  /** The normalized presentation, or `undefined` when nothing survived. */
  presentation: MessagePresentation | undefined;
  /** One entry per repaired or rejected block, in authored order. */
  notes: MessagePresentationBlockNote[];
}

function readBlocks(raw: unknown): Record<string, unknown>[] | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const blocks = (raw as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return undefined;
  return blocks.map((block) =>
    block !== null && typeof block === "object" ? (block as Record<string, unknown>) : {},
  );
}

function blockType(block: Record<string, unknown>): string {
  return typeof block["type"] === "string" && block["type"] !== "" ? block["type"] : "unknown";
}

/** A table's own first header, used as the caption the author left out. */
function defaultTableCaption(block: Record<string, unknown>): string | undefined {
  const headers = block["headers"];
  if (!Array.isArray(headers)) return undefined;
  const first = headers[0];
  return typeof first === "string" && first.trim() !== "" ? first.trim() : undefined;
}

function repairBlock(
  block: Record<string, unknown>,
  index: number,
  notes: MessagePresentationBlockNote[],
): Record<string, unknown> {
  const caption = block["caption"];
  const hasCaption = typeof caption === "string" && caption.trim() !== "";
  if (blockType(block) !== "table" || hasCaption) return block;
  const defaulted = defaultTableCaption(block);
  if (defaulted === undefined) return block;
  notes.push({
    index,
    type: "table",
    outcome: "repaired",
    reason: `table has no caption; used the first header ("${defaulted}")`,
  });
  return { ...block, caption: defaulted };
}

/** True when the normalizer keeps this block on its own. */
function isAdmitted(block: Record<string, unknown>): boolean {
  return (normalizeMessagePresentation({ blocks: [block] })?.blocks.length ?? 0) > 0;
}

/**
 * Normalizes an authored presentation, repairing what the portable contract can
 * fill in and reporting every block the normalizer refuses.
 *
 * A block is checked on its own, so a text block that only exists as the
 * continuation of the one before it is reported as rejected when the pair is
 * split — the reported reason is still true of the delivered message.
 */
export function admitMessagePresentation(raw: unknown): MessagePresentationAdmission {
  const blocks = readBlocks(raw);
  if (blocks === undefined) {
    return { presentation: normalizeMessagePresentation(raw), notes: [] };
  }
  const notes: MessagePresentationBlockNote[] = [];
  const repaired = blocks.map((block, index) => repairBlock(block, index, notes));
  const presentation = normalizeMessagePresentation({
    ...(raw as Record<string, unknown>),
    blocks: repaired,
  });
  for (const [index, block] of repaired.entries()) {
    if (isAdmitted(block)) continue;
    notes.push({
      index,
      type: blockType(block),
      outcome: "rejected",
      reason: `the ${blockType(block)} block is not a valid presentation block and was not delivered`,
    });
  }
  return { presentation, notes: notes.sort((left, right) => left.index - right.index) };
}
