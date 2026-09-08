// upstream: src/runtime.ts@5d8067a4483
// D-CORE-233: upstream's `RuntimeEnv` is the OpenClaw process runtime (exit,
// stdio, clock, fs, network, plugin host). Fusion's Hub owns the process, so
// the ported channel code sees the small surface it actually calls.
export type RuntimeEnv = {
  error: (message: string) => void;
  /** Upstream's `log` sink; the ported channel code writes notices through it. */
  log?: (message: string) => void;
  warn?: (message: string) => void;
  info?: (message: string) => void;
  debug?: (message: string) => void;
  exit?: (code: number) => void;
};

/** Process-wide runtime sink. Replaceable by the host; console by default. */
export const defaultRuntime: RuntimeEnv = {
  error: (message: string) => {
    console.error(message);
  },
  log: (message: string) => {
    console.log(message);
  },
  warn: (message: string) => {
    console.warn(message);
  },
  info: (message: string) => {
    console.info(message);
  },
  debug: (message: string) => {
    console.debug(message);
  },
};

/** A runtime whose `exit` never terminates the process. */
export function createNonExitingRuntime(base: RuntimeEnv = defaultRuntime): RuntimeEnv {
  return { ...base, exit: () => {} };
}
