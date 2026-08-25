import pino from "pino";

const REDACTED = "[Redacted]";
const SENSITIVE_KEYS = new Set([
  "auth",
  "authorization",
  "authorizationcode",
  "authorizationheader",
  "body",
  "clientsecret",
  "cause",
  "code",
  "codeverifier",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "headers",
  "authheader",
  "jwt",
  "password",
  "passwords",
  "privatekey",
  "rawbody",
  "request",
  "requestbody",
  "requestmetadata",
  "req",
  "secret",
  "secrets",
  "signature",
  "signingsecret",
  "state",
  "stack",
  "token",
  "tokens",
  "upstreampayload",
  "message",
]);
const SENSITIVE_KEY_PARTS = ["credential", "password", "privatekey", "signingsecret"];
const SAFE_ERROR_CODE = /^[A-Za-z][A-Za-z0-9_.:_-]{0,63}$/u;
const STACK_FRAME = /^\s+at\s+/u;
const ABSOLUTE_URL = /https?:\/\/[^\s"'<>]+/giu;
const errorRedaction = new WeakMap<Error, RedactionOptions>();
const safeErrorDiagnostics = new WeakSet<object>();

export interface RedactionOptions {
  /** Values already known to be sensitive at the boundary. Never serialized into the record. */
  scrubValues?: readonly string[];
}

export function createLogger(destination?: pino.DestinationStream): pino.Logger {
  const isDevelopment = process.env["NODE_ENV"] !== "production";
  const options: pino.LoggerOptions = {
    level: process.env["LOG_LEVEL"] ?? "info",
    formatters: {
      log(object) {
        return redactObject(object, [], []);
      },
    },
    serializers: {
      err: (value: unknown) =>
        isSafeErrorDiagnostic(value) ? value : serializeError(value, errorRedactionOptions(value)),
    },
  };

  if (destination !== undefined) return pino(options, destination);
  if (isDevelopment) {
    return pino({
      ...options,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
    });
  }
  return pino(options);
}

export function redact(value: unknown, options: RedactionOptions = {}): unknown {
  return redactValue(value, undefined, [], normalizedScrubValues(options.scrubValues));
}

/** Associates scrub provenance with an Error without putting the sensitive values on the record. */
export function errorForLog(error: Error, options: RedactionOptions = {}): Error {
  if (options.scrubValues !== undefined) errorRedaction.set(error, options);
  return error;
}

/**
 * Produces diagnostics from trusted Error structure, never from its untrusted message/stack
 * headline. Stack frames remain useful while arbitrary provider text does not enter the log.
 */
export function serializeError(
  value: unknown,
  options: RedactionOptions = {},
): Record<string, unknown> {
  if (!(value instanceof Error)) return safeErrorDiagnostic({ type: "NonError" });
  const scrubValues = normalizedScrubValues(options.scrubValues);
  const code = safeErrorCode(value, scrubValues);
  const frames = safeStackFrames(value.stack, scrubValues);
  return safeErrorDiagnostic({
    type: safeErrorType(value),
    ...(code === undefined ? {} : { code }),
    ...(frames === undefined ? {} : { stack: frames }),
    ...(value.cause === undefined ? {} : { cause: serializeError(value.cause, options) }),
  });
}

function redactValue(
  value: unknown,
  key: string | undefined,
  path: readonly string[],
  scrubValues: readonly string[],
): unknown {
  const normalizedKey = key === undefined ? undefined : normalizeKey(key);
  if (
    normalizedKey !== undefined &&
    isSensitiveKey(normalizedKey) &&
    !isSafeErrorDiagnosticPath(path, normalizedKey)
  ) {
    return REDACTED;
  }
  if (typeof value === "string") return redactString(value, key, scrubValues);
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, undefined, path, scrubValues));
  }
  if (value instanceof Error) {
    const owned = errorRedactionOptions(value);
    return serializeError(value, owned.scrubValues === undefined ? { scrubValues } : owned);
  }
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null) {
    return redactObject(value, path, scrubValues);
  }
  return value;
}

function redactObject(
  value: object,
  path: readonly string[],
  scrubValues: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, entryKey, [...path, normalizeKey(entryKey)], scrubValues),
    ]),
  );
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  return (
    SENSITIVE_KEYS.has(key) ||
    SENSITIVE_KEY_PARTS.some((part) => key.includes(part)) ||
    ["auth", "key", "secret", "signature", "token"].some((part) => key.endsWith(part))
  );
}

function isSafeErrorDiagnosticPath(path: readonly string[], key: string): boolean {
  return path[0] === "err" && ["cause", "code", "stack"].includes(key);
}

function redactString(
  value: string,
  key: string | undefined,
  scrubValues: readonly string[],
): string {
  let safe = scrubKnownValues(value, scrubValues);
  if (key !== undefined && ["url", "uri", "href"].includes(normalizeKey(key))) {
    return safeUrl(safe);
  }
  safe = safe.replace(ABSOLUTE_URL, (candidate) => safeUrl(candidate));
  return safe;
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return REDACTED;
  }
}

function normalizedScrubValues(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value) => value.length > 0))].sort(
    (left, right) => right.length - left.length,
  );
}

function scrubKnownValues(value: string, scrubValues: readonly string[]): string {
  let safe = value;
  for (const sensitive of scrubValues) safe = safe.split(sensitive).join(REDACTED);
  return safe;
}

function safeErrorType(error: Error): string {
  const name = error.constructor.name;
  return /^[A-Za-z][A-Za-z0-9_.-]{0,80}$/u.test(name) ? name : "Error";
}

function safeErrorCode(error: Error, scrubValues: readonly string[]): string | undefined {
  const value: unknown = Reflect.get(error, "code");
  if (typeof value !== "string" || !SAFE_ERROR_CODE.test(value)) return undefined;
  return scrubValues.includes(value) ? REDACTED : value;
}

function safeStackFrames(
  stack: string | undefined,
  scrubValues: readonly string[],
): string | undefined {
  if (stack === undefined) return undefined;
  const frames = stack
    .split("\n")
    .filter((line) => STACK_FRAME.test(line))
    .map((line) => redactString(line, undefined, scrubValues));
  return frames.length === 0 ? undefined : frames.join("\n");
}

function errorRedactionOptions(value: unknown): RedactionOptions {
  return value instanceof Error ? (errorRedaction.get(value) ?? {}) : {};
}

function safeErrorDiagnostic(value: Record<string, unknown>): Record<string, unknown> {
  safeErrorDiagnostics.add(value);
  return value;
}

function isSafeErrorDiagnostic(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && safeErrorDiagnostics.has(value);
}

export const logger = createLogger();
