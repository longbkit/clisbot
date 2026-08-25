import { z } from "zod";

const PgErrorCodeSchema = z
  .object({
    code: z.string().optional(),
  })
  .passthrough();

export class DatabaseUnavailableError extends Error {
  constructor(message = "database unavailable", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DatabaseUnavailableError";
  }
}

export class ConnectionAccessDeniedError extends Error {
  constructor() {
    super("connection access denied");
    this.name = "ConnectionAccessDeniedError";
  }
}

export class ConnectionConflictError extends Error {
  constructor() {
    super("connection already exists");
    this.name = "ConnectionConflictError";
  }
}

export class ConnectionAttemptUnavailableError extends Error {
  readonly code = "invalidInput";

  constructor() {
    super("connection attempt is invalid, expired, or already used");
    this.name = "ConnectionAttemptUnavailableError";
  }
}

export function isDatabaseUnavailableError(error: unknown): error is DatabaseUnavailableError {
  return error instanceof DatabaseUnavailableError;
}

export function toDatabaseError(error: unknown): Error {
  if (error instanceof DatabaseUnavailableError) {
    return error;
  }

  if (isUnavailablePgError(error)) {
    return new DatabaseUnavailableError("database unavailable", { cause: error });
  }

  return error instanceof Error ? error : new Error(String(error));
}

function isUnavailablePgError(error: unknown): boolean {
  const parsed = PgErrorCodeSchema.safeParse(error);

  if (!parsed.success) {
    return false;
  }

  const code = parsed.data.code;

  return (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "ECONNRESET" ||
    code === "57014" ||
    code === "57P01" ||
    (typeof code === "string" && code.startsWith("08"))
  );
}
