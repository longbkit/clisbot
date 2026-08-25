import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Logger } from "pino";
import { respondError, type Err } from "../contract/respond.js";
import { errorForLog, logger as defaultLogger, redact } from "../logger.js";

export type FailureKind =
  | "validation"
  | "authentication"
  | "forbidden"
  | "notFound"
  | "credentialsRejected"
  | "permissionMissing"
  | "rateLimited"
  | "network"
  | "timeout"
  | "upstreamUnavailable"
  | "conflict"
  | "internal";

export interface FailureContext {
  operation: string;
  component: string;
  provider?: "github" | "slack" | "discord" | "stripe";
  requestId?: string;
  status?: number;
  organizationSlug?: string;
  organizationId?: string;
  projectSlug?: string;
  projectId?: string;
  daemonId?: string;
  executionId?: string;
  method?: string;
  path?: string;
}

export interface FailureReport {
  kind: FailureKind;
  requestId: string;
}

interface FailureMessages {
  fallback: string;
  validation?: string;
  authentication?: string;
  forbidden?: string;
  notFound?: string;
  credentialsRejected?: string;
  permissionMissing?: string;
  rateLimited?: string;
  network?: string;
  timeout?: string;
  upstreamUnavailable?: string;
  conflict?: string;
  internal?: string;
}

export interface ReportOptions {
  logger?: Pick<Logger, "warn" | "error">;
  kind?: FailureKind;
  status?: number;
  /** Boundary-known sensitive values to remove without ever adding them to the log record. */
  scrubValues?: readonly string[];
  /** Additional diagnostics. Sensitive subtrees and request metadata are redacted recursively. */
  diagnostic?: Record<string, unknown>;
}

interface RequestFailureState {
  reported: boolean;
  logger?: Pick<Logger, "warn" | "error">;
}

const requestFailureState = new AsyncLocalStorage<RequestFailureState>();
const reportedErrors = new WeakMap<object, FailureReport>();

export function runWithFailureTracking<T>(
  operation: () => T,
  logger?: Pick<Logger, "warn" | "error">,
): T {
  return requestFailureState.run(
    { reported: false, ...(logger === undefined ? {} : { logger }) },
    operation,
  );
}

export function failureWasReported(): boolean {
  return requestFailureState.getStore()?.reported === true;
}

export function reportFailure(
  error: unknown,
  context: FailureContext,
  options: ReportOptions = {},
): FailureReport {
  const activeRequest = requestFailureState.getStore();
  if (activeRequest !== undefined) activeRequest.reported = true;
  if (typeof error === "object" && error !== null) {
    const existing = reportedErrors.get(error);
    if (existing !== undefined) return existing;
  }
  const kind = options.kind ?? classifyFailure(error, options.status ?? context.status);
  const requestId = context.requestId ?? randomUUID();
  const record = {
    err: errorForLog(
      asError(error),
      options.scrubValues === undefined ? {} : { scrubValues: options.scrubValues },
    ),
    failureKind: kind,
    requestId,
    ...context,
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.diagnostic === undefined
      ? {}
      : {
          diagnostic: redact(
            options.diagnostic,
            options.scrubValues === undefined ? {} : { scrubValues: options.scrubValues },
          ),
        }),
  };
  const log = options.logger ?? activeRequest?.logger ?? defaultLogger;
  if (isExpected(kind)) log.warn(record, `${context.operation} failed`);
  else log.error(record, `${context.operation} failed`);
  const report = { kind, requestId };
  if (typeof error === "object" && error !== null) reportedErrors.set(error, report);
  return report;
}

export function respondWithFailure(
  error: unknown,
  context: FailureContext,
  messages: FailureMessages,
  options: ReportOptions = {},
): Err {
  const report = reportFailure(error, context, options);
  const message = messages[report.kind] ?? messages.fallback;
  return respondError({
    message: shouldCorrelate(report.kind) ? withReference(message, report.requestId) : message,
  });
}

/**
 * Appends the correlation ID, after the copy that is actually useful and with the one instruction
 * that makes it worth reading. A bare identifier at the end of a sentence tells the reader
 * nothing about what they are supposed to do with it.
 */
export function withReference(message: string, requestId: string): string {
  return `${message} If it happens again, quote reference ${requestId} when reporting it.`;
}

export function classifyFailure(error: unknown, status?: number): FailureKind {
  const statusKind = classifyStatus(status);
  if (statusKind !== undefined) return statusKind;
  const code = errorProperty(error, "code") ?? errorProperty(error, "reason");
  const codeKind = code === undefined ? undefined : FAILURE_CODES.get(code);
  if (codeKind !== undefined) return codeKind;
  const name = error instanceof Error ? error.name : undefined;
  const nameKind = name === undefined ? undefined : classifyErrorName(name);
  if (nameKind !== undefined) return nameKind;
  const causeCode = errorCode(error instanceof Error ? error.cause : undefined);
  return causeCode === undefined ? "internal" : (TRANSPORT_CODES.get(causeCode) ?? "internal");
}

const FAILURE_CODES = new Map<string, FailureKind>([
  ["invalidInput", "validation"],
  ["invalidOrigin", "validation"],
  ["invalid_request", "validation"],
  ["authentication", "authentication"],
  ["unauthorized", "authentication"],
  ["forbidden", "forbidden"],
  ["notFound", "notFound"],
  ["not_found", "notFound"],
  ["credentialsRejected", "credentialsRejected"],
  ["permissionMissing", "permissionMissing"],
  ["rateLimited", "rateLimited"],
  ["network", "network"],
  ["unreachable", "network"],
  ["daemon_unreachable", "network"],
  ["timeout", "timeout"],
  ["upstreamUnavailable", "upstreamUnavailable"],
  ["invalidResponse", "upstreamUnavailable"],
  ["configurationConflict", "conflict"],
  ["identityConflict", "conflict"],
  ["conflict", "conflict"],
]);

const TRANSPORT_CODES = new Map<string, FailureKind>([
  ["ETIMEDOUT", "timeout"],
  ["UND_ERR_CONNECT_TIMEOUT", "timeout"],
  ["UND_ERR_HEADERS_TIMEOUT", "timeout"],
  ["ENOTFOUND", "network"],
  ["EAI_AGAIN", "network"],
  ["ECONNREFUSED", "network"],
  ["ECONNRESET", "network"],
  ["CERT_HAS_EXPIRED", "network"],
]);

function classifyStatus(status: number | undefined): FailureKind | undefined {
  if (status === undefined || status < 400) return undefined;
  return (
    new Map<number, FailureKind>([
      [401, "authentication"],
      [403, "forbidden"],
      [404, "notFound"],
      [409, "conflict"],
      [429, "rateLimited"],
    ]).get(status) ?? (status >= 500 ? "internal" : "validation")
  );
}

function classifyErrorName(name: string): FailureKind | undefined {
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  if (name.includes("Forbidden") || name.includes("AccessDenied")) return "forbidden";
  if (name.includes("NotFound")) return "notFound";
  if (name.includes("Conflict")) return "conflict";
  return undefined;
}

function isExpected(kind: FailureKind): boolean {
  return [
    "validation",
    "authentication",
    "forbidden",
    "notFound",
    "credentialsRejected",
    "permissionMissing",
    "conflict",
  ].includes(kind);
}

function shouldCorrelate(kind: FailureKind): boolean {
  return ["network", "timeout", "rateLimited", "upstreamUnavailable", "internal"].includes(kind);
}

function errorProperty(error: unknown, property: string): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value: unknown = Reflect.get(error, property);
  return typeof value === "string" ? value : undefined;
}

function errorCode(error: unknown): string | undefined {
  return errorProperty(error, "code");
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("non-Error failure");
}
