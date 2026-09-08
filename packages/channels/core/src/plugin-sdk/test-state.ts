// Fusion-owned boundary for `src/plugin-sdk/test-state.ts` (D-CORE-263).
//
// Upstream's `createOpenClawTestState` builds a whole OpenClaw installation in a
// temp directory — home/state/workspace layouts, a written `openclaw.json`, agent
// and session directories, auth profiles, gateway ports, and the env swap that
// points the process at it. Fusion has no OpenClaw installation to fake: the Hub
// owns config, sessions and agents, and the ported channel tests use the state
// directory only as an isolated scratch root.
//
// So this keeps the constructor name, the option names the ported tests pass and
// the fields they read, and creates one temp directory. Nothing in it is
// pre-populated and no process env is swapped, because no ported code reads
// either.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type OpenClawTestStateOptions = {
  prefix?: string;
  label?: string;
  layout?: "home" | "split" | "state-only";
};

export type OpenClawTestState = {
  root: string;
  stateDir: string;
  path: (...parts: string[]) => string;
  statePath: (...parts: string[]) => string;
  cleanup: () => Promise<void>;
};

const DEFAULT_PREFIX = "fusion-channel-test-state-";

/** Creates one isolated temp state root for a ported channel test. */
export async function createOpenClawTestState(
  options: OpenClawTestStateOptions = {},
): Promise<OpenClawTestState> {
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const stateDir = options.layout === "state-only" ? root : path.join(root, "state");
  await fs.mkdir(stateDir, { recursive: true });
  return {
    root,
    stateDir,
    path: (...parts: string[]) => path.join(root, ...parts),
    statePath: (...parts: string[]) => path.join(stateDir, ...parts),
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

/** Runs `run` with a temp state root and cleans it up afterwards. */
export async function withOpenClawTestState<T>(
  options: OpenClawTestStateOptions,
  run: (state: OpenClawTestState) => Promise<T>,
): Promise<T> {
  const state = await createOpenClawTestState(options);
  try {
    return await run(state);
  } finally {
    await state.cleanup();
  }
}
