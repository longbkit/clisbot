import type { Logger } from "pino";
import { logger as defaultLogger } from "../logger.js";
import { reportFailure } from "./index.js";

type ProcessFailureEvent = "unhandledRejection" | "uncaughtException";
type ProcessFailureListener = (error: unknown) => void;

export interface ProcessFailureTarget {
  on(event: ProcessFailureEvent, listener: ProcessFailureListener): unknown;
  off(event: ProcessFailureEvent, listener: ProcessFailureListener): unknown;
  exit(code: number): never;
}

interface ProcessFailureInstallation {
  remove(): void;
}

const installations = new WeakMap<object, ProcessFailureInstallation>();

export function installProcessFailureHandlers(
  target: ProcessFailureTarget = process,
  logger: Pick<Logger, "warn" | "error"> = defaultLogger,
): () => void {
  const existing = installations.get(target as object);
  if (existing !== undefined) return () => existing.remove();

  const onUnhandledRejection: ProcessFailureListener = (error) => {
    reportFailure(
      error,
      { operation: "process.unhandled_rejection", component: "process" },
      { logger },
    );
    target.exit(1);
  };
  const onUncaughtException: ProcessFailureListener = (error) => {
    reportFailure(
      error,
      { operation: "process.uncaught_exception", component: "process" },
      { logger },
    );
    target.exit(1);
  };
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    target.off("unhandledRejection", onUnhandledRejection);
    target.off("uncaughtException", onUncaughtException);
    installations.delete(target as object);
  };
  installations.set(target as object, { remove });
  target.on("unhandledRejection", onUnhandledRejection);
  target.on("uncaughtException", onUncaughtException);
  return remove;
}
