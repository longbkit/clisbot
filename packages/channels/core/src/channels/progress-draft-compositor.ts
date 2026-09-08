// upstream: src/channels/progress-draft-compositor.ts@5d8067a4483
// D-CORE-403: upstream's compositor accumulates a live agent turn's progress
// events into a draft snapshot (event ingestion, line merge/dedupe, status
// text, visibility gating, work counter). Fusion's Hub owns agent turns and
// produces the snapshot itself, so only the snapshot shape the channel
// renderers consume is ported; the compositor factory and its
// `progress-draft-events` / `progress-draft-lines` /
// `progress-draft-status-text` / `progress-visibility` /
// `progress-work-counter` closure are omitted.
import type { ChannelProgressDraftDiffStat } from "./progress-draft-diffstat.js";
import type { AgentPlanStep, ChannelProgressDraftLine } from "./streaming.js";

export type ChannelProgressDraftCompositorLine = string | ChannelProgressDraftLine;
export type ChannelProgressDraftCompositorSnapshot = Readonly<{
  lines: readonly ChannelProgressDraftCompositorLine[];
  label?: string;
  statusHeadline?: string;
  plan?: readonly AgentPlanStep[];
  planExplanation?: string;
  diffStat?: ChannelProgressDraftDiffStat;
}>;
