import { createPerfCollector, type PerfCollector } from "./collector";

/**
 * The idle CPU probe (docs/mobile-testing.md#idle-cpu-probe). Off unless the build sets
 * `EXPO_PUBLIC_CLISBOT_PERF_PROBE=1`; everything that feeds it checks for null first, so a normal
 * build pays one null check per hook.
 */
export const perfProbe: PerfCollector | null =
  process.env.EXPO_PUBLIC_CLISBOT_PERF_PROBE === "1"
    ? createPerfCollector({ now: () => performance.now() })
    : null;
