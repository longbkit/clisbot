export interface ConnectionResolutionContext {
  executionId?: string;
  registerToken?: (token: string, revoke?: () => Promise<void> | void) => Promise<void> | void;
}

export type ConnectionResolver = (
  connectionSlug: string,
  value: string,
  context?: ConnectionResolutionContext,
) => Promise<string> | string;
