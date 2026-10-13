import type { GitCommitSummary, GitWorktreeInspection } from "@clisbot/protocol/messages";
import { inlineCode, literalText } from "./command-reply-format.js";

export function committedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "unknown date"
    : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
export function commitLine(commit: GitCommitSummary | null | undefined): string {
  if (!commit) return "Commit: unavailable";
  return `Commit: ${inlineCode(commit.hash.slice(0, 8))} · ${committedDate(commit.committedAt)} · ${literalText(commit.author)}`;
}
export function gitStatusLine(inspection: GitWorktreeInspection | undefined): string {
  const status = inspection?.status;
  if (!status) return "Status: unavailable";
  if (!status.tracked && !status.untracked) return "Status: clean";
  const parts = [];
  if (status.untracked)
    parts.push(`${status.untracked} untracked file${status.untracked === 1 ? "" : "s"}`);
  parts.push(
    status.tracked
      ? `${status.tracked} tracked file${status.tracked === 1 ? "" : "s"} changed (${status.staged} staged, ${status.unstaged} unstaged)`
      : "no tracked changes",
  );
  if (status.conflicts)
    parts.push(`${status.conflicts} conflict${status.conflicts === 1 ? "" : "s"}`);
  return `Status: ${parts.join("; ")}`;
}
