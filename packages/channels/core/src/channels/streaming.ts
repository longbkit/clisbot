// upstream: src/channels/streaming.ts@5d8067a4483
// D-CORE-231: upstream's `streaming.ts` is the channel streaming/draft policy
// engine (preview availability, block streaming, progress cards, per-account
// compat readers). Fusion's Hub owns turn streaming, so this file carries the
// chunk-mode reader the outbound chunker calls, over the compat entry readers
// already ported in `streaming-config-readers.ts`.
import { sliceUtf16Safe } from "../normalization-core/utf16-slice.js";
import { compactProgressText } from "../shared/text-truncate.js";
import type { BlockStreamingChunkConfig, TextChunkMode } from "../config/types.base.js";
import { asNullableRecord as asObjectRecord } from "../normalization-core/record-coerce.js";
import {
  getChannelStreamingConfigObject,
  type StreamingCompatEntry,
} from "./streaming-config-readers.js";

export function resolveChannelStreamingChunkMode(
  entry: StreamingCompatEntry | null | undefined,
): TextChunkMode | undefined {
  const mode = (getChannelStreamingConfigObject(entry) as { chunkMode?: unknown } | undefined)
    ?.chunkMode;
  return mode === "length" || mode === "newline" ? mode : undefined;
}

// --- progress-draft plan/line group (verbatim upstream, same file) ---------
// The Slack progress blocks (packages/channels/slack/src/progress-blocks.ts)
// read the plan-step + draft-line shapes and the checklist/compaction
// renderers from this module. They are copied byte-identical from the same
// upstream file; the streaming policy engine around them stays omitted
// (D-CORE-231).

export type AgentPlanStepStatus = "pending" | "in_progress" | "completed";

export type AgentPlanStep = {
  step: string;
  status: AgentPlanStepStatus;
};

type AgentPlanStepInput = AgentPlanStep | string;

function isAgentPlanStepStatus(value: unknown): value is AgentPlanStepStatus {
  return value === "pending" || value === "in_progress" || value === "completed";
}

/**
 * TODO(remove): normalizes the pre-2026.7.2 string plan-step wire shape to
 * pending typed steps. Bundled producers all emit typed steps, and
 * @openclaw/codex is force-updated with core, so this only covers a plugin
 * pinned against an update. Delete once that cannot happen.
 */
export function normalizeAgentPlanSteps(value: unknown): AgentPlanStep[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.flatMap((entry) => {
    if (typeof entry === "string") {
      const step = entry.trim();
      return step ? [{ step, status: "pending" as const }] : [];
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const rawStep = (entry as { step?: unknown }).step;
    const status = (entry as { status?: unknown }).status;
    const step = typeof rawStep === "string" ? rawStep.trim() : "";
    return step && isAgentPlanStepStatus(status) ? [{ step, status }] : [];
  });
}

const EMOJI_PREFIX_RE = /^\p{Extended_Pictographic}/u;

export type ChannelProgressDraftLineInput =
  | {
      event: "tool";
      itemId?: string;
      toolCallId?: string;
      name?: string;
      phase?: string;
      args?: Record<string, unknown>;
    }
  | {
      event: "item";
      itemId?: string;
      toolCallId?: string;
      itemKind?: string;
      title?: string;
      name?: string;
      phase?: string;
      status?: string;
      summary?: string;
      progressText?: string;
      meta?: string;
      commandBearing?: boolean;
    }
  | {
      event: "plan";
      phase?: string;
      title?: string;
      explanation?: string;
      steps?: readonly AgentPlanStepInput[];
    }
  | {
      event: "approval";
      approvalId?: string;
      phase?: string;
      title?: string;
      command?: string;
      reason?: string;
      message?: string;
    }
  | {
      event: "command-output";
      itemId?: string;
      toolCallId?: string;
      phase?: string;
      title?: string;
      name?: string;
      status?: string;
      exitCode?: number | null;
    }
  | {
      event: "patch";
      itemId?: string;
      toolCallId?: string;
      phase?: string;
      title?: string;
      name?: string;
      added?: string[];
      modified?: string[];
      deleted?: string[];
      summary?: string;
    };

type ChannelProgressDraftLineKind = ChannelProgressDraftLineInput["event"];

export type ChannelProgressDraftLine = {
  /** Stable line id used to update an existing progress line in place. */
  id?: string;
  /** Progress event family that produced this line. */
  kind: ChannelProgressDraftLineKind;
  /** Rendered line text before final draft truncation/prefix formatting. */
  text: string;
  /** Human-readable label for UI renderers. */
  label: string;
  /** Optional leading icon for rich or plain progress renderers. */
  icon?: string;
  /** Compact detail text separated from label/icon. */
  detail?: string;
  /** Optional lifecycle status, such as completed or exit code. */
  status?: string;
  /** Normalized tool name when the line represents tool work. */
  toolName?: string;
  /** Whether final formatting should add a bullet/line prefix. */
  prefix?: boolean;
};


/** Lines that need the operator's attention even when routine tool rows are hidden. */
export function isChannelProgressAttentionLine(line: string | ChannelProgressDraftLine): boolean {
  if (typeof line === "string") {
    return false;
  }
  const status = line.status?.toLowerCase();
  return (
    line.kind === "approval" ||
    status === "failed" ||
    status === "error" ||
    status === "blocked" ||
    (status?.startsWith("exit ") === true && status !== "exit 0")
  );
}

function compactProgressLineDetail(detail: string, maxChars: number): string {
  const chars = Array.from(sliceUtf16Safe(detail, 0, (maxChars + 1) * 2));
  if (chars.length <= maxChars) {
    return detail;
  }
  if (maxChars <= 1) {
    return "…";
  }
  const keepStart = Math.max(1, Math.ceil((maxChars - 1) * 0.45));
  const keepEnd = Math.max(1, maxChars - keepStart - 1);
  const rawStart = chars.slice(0, keepStart).join("").trimEnd();
  const start =
    rawStart.length > 8 && /\s+\S+$/.test(rawStart) ? rawStart.replace(/\s+\S+$/, "") : rawStart;
  const tail = Array.from(sliceUtf16Safe(detail, -keepEnd * 2))
    .slice(-keepEnd)
    .join("");
  return `${start}…${tail.trimStart()}`;
}

function removeUnbalancedInlineBackticks(value: string): string {
  const backtickCount = value.match(/`/g)?.length ?? 0;
  if (backtickCount % 2 === 0) {
    return value;
  }
  return value.trimStart().startsWith("`") ? value.replaceAll("`", "'") : value.replaceAll("`", "");
}

function repairCompactedProgressMarkdown(value: string): string {
  const withoutDanglingBackticks = removeUnbalancedInlineBackticks(value);
  const trimmedStart = withoutDanglingBackticks.trimStart();
  if (!trimmedStart.startsWith("_") || trimmedStart.endsWith("_")) {
    return withoutDanglingBackticks;
  }
  const underscoreCount = trimmedStart.match(/_/g)?.length ?? 0;
  if (underscoreCount % 2 === 0) {
    return withoutDanglingBackticks;
  }
  const leadingWhitespace = withoutDanglingBackticks.slice(
    0,
    withoutDanglingBackticks.length - trimmedStart.length,
  );
  return `${leadingWhitespace}${trimmedStart.slice(1)}`;
}

export function compactChannelProgressDraftLine(line: string, maxChars: number): string {
  const normalized = line.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  // Two UTF-16 units per code point retain the full budget plus an overflow sentinel.
  const chars = Array.from(sliceUtf16Safe(normalized, 0, (Math.max(0, maxChars) + 1) * 2));
  if (chars.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 1) {
    return "…";
  }

  const compactWithPrefix = (prefix: string, detail: string): string | undefined => {
    const prefixChars = Array.from(sliceUtf16Safe(prefix, 0, (maxChars + 1) * 2)).length;
    const detailLimit = maxChars - prefixChars;
    if (detailLimit < 8) {
      return undefined;
    }
    // Keep the stable tool label/icon visible while trimming volatile command
    // detail; this reduces progress draft edit churn in chat UIs.
    return repairCompactedProgressMarkdown(
      `${prefix}${compactProgressLineDetail(detail, detailLimit)}`,
    );
  };

  const splitIndex = normalized.indexOf(": ");
  if (splitIndex > 0) {
    const prefix = normalized.slice(0, splitIndex + 2);
    const compact = compactWithPrefix(prefix, normalized.slice(splitIndex + 2));
    if (compact) {
      return compact;
    }
  }

  const compactCommandPrefixMatch = normalized.match(/^🛠️\s+/u);
  if (compactCommandPrefixMatch) {
    const prefix = compactCommandPrefixMatch[0];
    const compact = compactWithPrefix(prefix, normalized.slice(prefix.length));
    if (compact) {
      return compact;
    }
  }

  return repairCompactedProgressMarkdown(compactProgressText(normalized, maxChars, chars));
}

export function selectPlanChecklistSteps(
  steps: readonly AgentPlanStep[],
  options: { maxLines: number },
): { steps: AgentPlanStep[]; summary?: string } {
  const normalizedSteps = steps
    .map((entry, index) => ({ ...entry, step: entry.step.replace(/\s+/g, " ").trim(), index }))
    .filter((entry) => entry.step);
  if (normalizedSteps.length === 0 || options.maxLines <= 0) {
    return { steps: [] };
  }
  if (normalizedSteps.length <= options.maxLines) {
    return { steps: normalizedSteps };
  }
  const availableSteps = Math.max(0, options.maxLines - 1);
  const pendingSteps = normalizedSteps.filter((entry) => entry.status !== "completed");
  const activeStep =
    availableSteps > 0 ? pendingSteps.find((entry) => entry.status === "in_progress") : undefined;
  const pendingSlots = Math.max(0, availableSteps - (activeStep ? 1 : 0));
  // slice(-0) would return the whole array and blow past the line cap.
  const pendingTail =
    pendingSlots === 0
      ? []
      : pendingSteps.filter((entry) => entry !== activeStep).slice(-pendingSlots);
  const visiblePending = [...(activeStep ? [activeStep] : []), ...pendingTail];
  const completedSlots = Math.max(0, availableSteps - visiblePending.length);
  const recentCompleted =
    completedSlots > 0
      ? normalizedSteps.filter((entry) => entry.status === "completed").slice(-completedSlots)
      : [];
  const visibleSteps = [...recentCompleted, ...visiblePending].toSorted(
    (a, b) => a.index - b.index,
  );
  const completedCount = normalizedSteps.length - pendingSteps.length;
  return { steps: visibleSteps, summary: `${completedCount}/${normalizedSteps.length} done` };
}

export function formatPlanChecklistLines(
  steps: readonly AgentPlanStep[],
  options: {
    maxLines: number;
    maxLineChars: number;
    /** @deprecated v2026.9.1 SDK option; retain until a breaking SDK release. */
    plain?: boolean;
  },
): string[] {
  const selected = selectPlanChecklistSteps(steps, options);
  const marker = (status: AgentPlanStepStatus) =>
    options.plain
      ? status === "completed"
        ? "Completed:"
        : status === "in_progress"
          ? "In progress:"
          : "Pending:"
      : status === "completed"
        ? "✅"
        : status === "in_progress"
          ? "▸"
          : "▢";
  return [
    ...(selected.summary ? [`${options.plain ? "" : "✅ "}${selected.summary}`] : []),
    ...selected.steps.map((entry) => `${marker(entry.status)} ${entry.step}`),
  ].map((line) => compactChannelProgressDraftLine(line, options.maxLineChars));
}


// Slice 22 addition (Telegram streaming/progress port): the draft-stream
// chunking resolver reads the preview chunk config from this same upstream file.
export type { StreamingCompatEntry } from "./streaming-config-readers.js";

export function resolveChannelStreamingPreviewChunk(
  entry: StreamingCompatEntry | null | undefined,
): BlockStreamingChunkConfig | undefined {
  const chunk = asObjectRecord(getChannelStreamingConfigObject(entry)?.preview?.chunk);
  return (chunk as BlockStreamingChunkConfig | null) ?? undefined;
}
