// upstream: extensions/telegram/src/api-logging.ts@5d8067a4483
// Telegram plugin module implements api logging behavior.
import { createSubsystemLogger } from "@getpaseo/channels-core/plugin-sdk/runtime-env";
import type { RuntimeEnv } from "@getpaseo/channels-core/plugin-sdk/runtime-env";
import { formatErrorMessage } from "@getpaseo/channels-core/plugin-sdk/ssrf-runtime";

type TelegramApiLogger = (message: string) => void;

type TelegramApiLoggingParams<T> = {
  operation: string;
  fn: () => Promise<T>;
  runtime?: Pick<RuntimeEnv, "error">;
  logger?: TelegramApiLogger;
  shouldLog?: (err: unknown) => boolean;
};

const fallbackLogger = createSubsystemLogger("telegram/api");

function resolveTelegramApiLogger(runtime?: Pick<RuntimeEnv, "error">, logger?: TelegramApiLogger) {
  if (logger) {
    return logger;
  }
  if (runtime?.error) {
    return runtime.error;
  }
  return (message: string) => fallbackLogger.error(message);
}

export async function withTelegramApiErrorLogging<T>({
  operation,
  fn,
  runtime,
  logger,
  shouldLog,
}: TelegramApiLoggingParams<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!shouldLog || shouldLog(err)) {
      const errText = formatErrorMessage(err);
      const log = resolveTelegramApiLogger(runtime, logger);
      log(`telegram ${operation} failed: ${errText}`);
    }
    throw err;
  }
}
