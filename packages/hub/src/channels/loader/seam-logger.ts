// Process-wide logger sink for the bound channel-inbound seam module
// (hosts/channel-inbound.ts). The seam runs from a SEPARATE compilation — a
// real file under `hostBaseDir` loaded at drive time by the node:module hooks,
// never through the Hub's own module graph (loader-routing.md) — so it cannot
// import the supervisor's logger; a direct import would be dead code in that
// process. Instead the supervisor assigns itself at construction and the seam
// reports its no-runtime miss through this sink at call time.
//
// Same mechanism as runtime-store.ts's `Symbol.for` store: one sink per process
// no matter how many copies of this module are loaded; when nothing has
// assigned a sink (a test that drives the seam without the supervisor), the
// miss stays silent — the P13 contract there is the no-dispatch result, not the
// log line.

import type { PlaneLogger } from "../plane/types.js";

const SEAM_LOGGER = Symbol.for("@getpaseo/hub/channel-seam-logger");

type SeamLoggerGlobal = typeof globalThis & { [SEAM_LOGGER]?: PlaneLogger };

/** The supervisor calls this once; the seam's no-runtime miss path then logs
 * through the assigned logger. Idempotent; a re-assign replaces the sink. */
export function setChannelSeamLogger(logger: PlaneLogger): void {
  const globals = globalThis as SeamLoggerGlobal;
  globals[SEAM_LOGGER] = logger;
}

/** The assigned sink, or undefined when nothing assigned one (the miss then
 * stays silent — see the module header). */
export function getChannelSeamLogger(): PlaneLogger | undefined {
  const globals = globalThis as SeamLoggerGlobal;
  return globals[SEAM_LOGGER];
}

/** Test-only: drop the assigned sink. */
export function clearChannelSeamLogger(): void {
  const globals = globalThis as SeamLoggerGlobal;
  delete globals[SEAM_LOGGER];
}
