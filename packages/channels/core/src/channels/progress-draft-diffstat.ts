// upstream: src/channels/progress-draft-diffstat.ts@5d8067a4483
// D-CORE-402: the second half of the upstream file is
// `createProgressDraftDiffStatTracker`, which accumulates per-tool file
// mutations by reading OpenClaw's agent tool args
// (`agents/file-mutation-args.ts` → `agents/apply-patch-paths.ts` →
// `agents/path-policy.ts` / `agents/sandbox-paths.ts` / the sandbox fs
// bridge). Fusion's Hub owns agent turns, so nothing in this repo produces
// those tool events; the tracker and its closure are omitted and only the
// diff-stat shape plus its renderer — the part the Slack progress blocks
// call — is ported, byte-identical.
export type ChannelProgressDraftDiffStat = Readonly<{
  files: number;
  added: number;
  removed: number;
}>;

export function formatChannelProgressDraftDiffStat(
  diffStat: ChannelProgressDraftDiffStat | undefined,
): string | undefined {
  if (!diffStat || (diffStat.files === 0 && diffStat.added === 0 && diffStat.removed === 0)) {
    return undefined;
  }
  return [
    `📝 ${diffStat.files} files`,
    ...(diffStat.added > 0 ? [`+${diffStat.added}`] : []),
    ...(diffStat.removed > 0 ? [`−${diffStat.removed}`] : []),
  ].join(" ");
}
