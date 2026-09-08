// Fusion-owned host adapter for `src/media/parse.ts` (D-CORE-053).
//
// Upstream scans model text for media directives and Markdown images and lifts
// them out as attachments (with SSRF/IP policy on discovered URLs). Fusion takes
// media through explicit `message` media params, so text is
// never rewritten into attachments behind the agent's back; the text passes
// through and no media is extracted.
export type SplitMediaResult = {
  text: string;
  mediaUrls?: string[];
  audioAsVoice?: boolean;
};

export function splitMediaFromOutput(
  raw: string,
  _options?: { extractMarkdownImages?: boolean; extractMediaDirectives?: boolean },
): SplitMediaResult {
  return { text: raw };
}
