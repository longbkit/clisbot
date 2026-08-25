import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type { AppSetupSession } from "./hub.js";

/**
 * Where the app setup screenshots land. Gitignored evidence for the handoff, written from the
 * real built application rather than a component harness.
 */
export const SHOTS = join(process.cwd(), ".dev", "operator-app-evidence", "shots");

mkdirSync(SHOTS, { recursive: true });
