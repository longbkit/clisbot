import { join, resolve } from "node:path";

const RUNTIME_ROOT = Symbol.for("@getpaseo/hub/runtime-root");

type RuntimeGlobal = typeof globalThis & { [RUNTIME_ROOT]?: string };

/** Pins packaged assets to the installed Hub package instead of the caller's working directory. */
export function configureRuntimeRoot(root: string): () => void {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  const previous = runtimeGlobal[RUNTIME_ROOT];
  runtimeGlobal[RUNTIME_ROOT] = resolve(root);
  return () => {
    if (previous === undefined) delete runtimeGlobal[RUNTIME_ROOT];
    else runtimeGlobal[RUNTIME_ROOT] = previous;
  };
}

export function runtimeFile(...segments: string[]): string {
  return join((globalThis as RuntimeGlobal)[RUNTIME_ROOT] ?? process.cwd(), ...segments);
}
