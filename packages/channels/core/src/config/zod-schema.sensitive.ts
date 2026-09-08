// Fusion-owned partial port of `src/config/zod-schema.sensitive.ts` (D-CORE-336).
//
// Upstream also exports `configUiMetadata`, the UI-hint registry the host
// dashboard reads; Fusion's app owns channel config presentation. The sensitive
// registry itself is upstream's, so a ported schema keeps its redaction marks.
// Defines sensitive config schema fragments and redaction metadata.
import { z } from "zod";

// Everything registered here will be redacted when the config is exposed,
// e.g. sent to the dashboard
export const sensitive = z.registry<undefined, z.ZodType>();
