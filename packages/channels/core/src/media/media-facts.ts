// upstream: src/media/media-facts.ts@5d8067a4483
// D-CORE-500: upstream's `media-facts.ts` is the runtime attachment fact store
// (559 lines: prompt-image ordering, symbol-keyed runtime projection, staged
// hydration, legacy `Media*` reprojection). Fusion's Hub owns attachment
// staging, so this file carries only the `MediaFact` shape the ported channel
// inbound types are declared against, verbatim from upstream.
import type { MediaKind } from "../media-core/constants.js";

/** One ordered runtime attachment; array position is its alignment identity. */
export type MediaFact = {
  path?: string;
  url?: string;
  contentType?: string;
  kind?: MediaKind;
  fileName?: string;
  sizeBytes?: number;
  durationMs?: number;
  width?: number;
  height?: number;
  transcribed?: boolean;
  messageId?: string;
  workspaceDir?: string;
  /** Internal proof that this exact fact was covered by a legacy staged projection. */
  staged?: boolean;
  // Declared field, not a symbol: suppression must survive every fact copy or
  // reprojection boundary; described images otherwise rehydrate or count failed.
  // Structured persistence may retain it; legacy Media* projections never emit it.
  hydrationSuppressed?: boolean;
};

export type MediaFactInput = {
  [Key in keyof MediaFact]?: MediaFact[Key] | null;
};
