export class ProjectCommandError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProjectCommandError";
  }
}

/**
 * `ProjectDashboard` is constructed in the composition root, a different bundler chunk than the
 * `createServerFn` handlers that catch what it throws, so a thrown `ProjectCommandError` can
 * carry a different class identity by the time it reaches a handler's catch block —
 * `instanceof` is unreliable across that boundary. Check identity by the stable `name` here and
 * read `.code` only once that identity is established, rather than repeating the same fragile
 * `instanceof` check at the call site.
 *
 * This lives in its own module, not in `dashboard.ts`, so that `functions.ts` can map the error
 * to a message without importing `dashboard.ts`'s heavy, Node-only dependency chain (YAML
 * compilation, `node:crypto`) into the client bundle graph.
 */
export function projectCommandErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name !== "ProjectCommandError") return undefined;
  if (!("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}
