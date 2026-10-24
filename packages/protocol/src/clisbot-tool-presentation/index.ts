import type { ToolCallDetail } from "../agent-types.js";
import { getClisbotToolLeafName, isClisbotToolName } from "../tool-name-normalization.js";
import { getClisbotToolEntry, CLISBOT_TOOL_CATALOG, type ClisbotToolName } from "./catalog.js";
import { toSummaryText } from "./summary-text.js";

export { buildAgentMessageDisplay, type AgentMessageDisplay } from "./agent-message.js";
export {
  buildClisbotToolDetailSections,
  type ClisbotToolDetailField,
  type ClisbotToolDetailSection,
} from "./detail-sections.js";
export { MAX_SUMMARY_CHARS } from "./summary-text.js";
export type { ClisbotToolName };

export interface ClisbotToolDisplayInput {
  toolName: string;
  detail: ToolCallDetail;
  /** Title of the agent named by the call's `agentId`, when the caller knows it. */
  targetAgentTitle?: string;
}

export interface ClisbotToolDisplay {
  displayName: string;
  summary?: string;
}

export const CLISBOT_TOOL_NAMES = Object.keys(CLISBOT_TOOL_CATALOG) as readonly ClisbotToolName[];

/** Returns null for tools outside the Clisbot namespace. */
export function buildClisbotToolDisplay(input: ClisbotToolDisplayInput): ClisbotToolDisplay | null {
  const leafName = clisbotLeafName(input.toolName);
  if (!leafName) return null;
  const entry = getClisbotToolEntry(leafName);
  if (!entry) return { displayName: humanizeLeafName(leafName) };

  const toolInput = readToolInput(input.detail);
  const targetAgent = input.targetAgentTitle ?? readString(toolInput.agentId);
  const summary = formatContext(entry.context?.(toolInput, targetAgent));
  return { displayName: entry.label, ...(summary ? { summary } : {}) };
}

/** The agent a Clisbot call acts on, so callers can resolve its title. */
export function getClisbotToolTargetAgentId(
  toolName: string,
  detail: ToolCallDetail | undefined,
): string | null {
  if (!detail || !clisbotLeafName(toolName)) return null;
  return readString(readToolInput(detail).agentId) ?? null;
}

function clisbotLeafName(toolName: string): string | null {
  return isClisbotToolName(toolName) ? getClisbotToolLeafName(toolName) : null;
}

function readToolInput(detail: ToolCallDetail): Readonly<Record<string, unknown>> {
  if (detail.type !== "unknown") return {};
  const value = detail.input;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function formatContext(value: unknown): string | undefined {
  if (typeof value === "string") return toSummaryText(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const [first, ...rest] = value;
    const head = typeof first === "string" ? toSummaryText(first) : undefined;
    if (!head) return undefined;
    return rest.length > 0 ? `${head} +${rest.length}` : head;
  }
  return undefined;
}

function humanizeLeafName(leafName: string): string {
  const sentence = leafName
    .replace(/[._-]+/g, " ")
    .trim()
    .toLowerCase();
  return `${sentence[0]?.toUpperCase() ?? ""}${sentence.slice(1)}`;
}
