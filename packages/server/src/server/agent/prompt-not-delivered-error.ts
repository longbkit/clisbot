/**
 * Thrown when a prompt provably never reached the provider, so sending the same logical message
 * again cannot deliver it twice. Throw it only from a point before any dispatch to the provider;
 * a failure that may have followed dispatch is ambiguous and must stay a plain error.
 */
export class PromptNotDeliveredError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PromptNotDeliveredError";
  }
}

export function isPromptNotDeliveredError(error: unknown): error is PromptNotDeliveredError {
  return error instanceof PromptNotDeliveredError;
}
