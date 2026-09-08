// Fusion-owned host adapter for `src/agents/sandbox-paths.ts` (D-CORE-024).
//
// Upstream maps a container path back to the host path of an OpenClaw sandbox
// (container workdir mapping, managed media roots, `file:` URL rewriting). Fusion
// agents run on the Paseo daemon's own filesystem and the Hub never sets
// `sandboxRoot`, so mapping is the identity. The data-URL guard is carried
// verbatim because it is an input rule, not a sandbox mapping.
const DATA_URL_RE = /^data:/i;

export function assertMediaNotDataUrl(media: string): void {
  const raw = media.trim();
  if (DATA_URL_RE.test(raw)) {
    throw new Error("data: URLs are not supported for media. Use buffer instead.");
  }
}

/** No sandbox mapping in Fusion: the source is already a host-visible path. */
export async function resolveSandboxedMediaSource(params: {
  media: string;
  sandboxRoot: string;
  containerWorkdir?: string;
}): Promise<string> {
  return params.media.trim();
}
