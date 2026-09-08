// upstream: extensions/zalo/src/monitor.types.ts@5d8067a4483
// Zalo type declarations define plugin contracts.
export type ZaloRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};
