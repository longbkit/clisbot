export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly description: string,
    readonly errorCode?: number,
  ) {
    super(
      `telegram ${method} failed${description ? `: ${description}` : ""}`,
    );
    this.name = "TelegramApiError";
  }
}

const DEFAULT_TELEGRAM_API_TIMEOUT_MS = 8_000;

export function getTelegramRetryAfterMs(params: {
  description?: string;
  parameters?: {
    retry_after?: number;
  };
}) {
  const retryAfterSeconds =
    params.parameters?.retry_after ??
    Number.parseInt(
      params.description?.match(/retry after\s+(\d+)/i)?.[1] ?? "",
      10,
    );

  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    return null;
  }

  return retryAfterSeconds * 1000;
}

export function isTelegramPollingConflict(error: unknown) {
  return (
    error instanceof TelegramApiError &&
    error.method === "getUpdates" &&
    error.errorCode === 409
  );
}

export async function retryTelegramPollingConflict<TResult>(params: {
  operation: () => Promise<TResult>;
  retryDelayMs: number;
  maxWaitMs: number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const sleep = params.sleep ?? ((ms: number) => Bun.sleep(ms));
  const deadline = Date.now() + params.maxWaitMs;

  while (true) {
    try {
      return await params.operation();
    } catch (error) {
      if (!isTelegramPollingConflict(error) || Date.now() >= deadline) {
        throw error;
      }

      await sleep(params.retryDelayMs);
    }
  }
}

export async function callTelegramApi<TResult>(
  token: string,
  method: string,
  params: Record<string, unknown>,
  options: {
    signal?: AbortSignal;
    rateLimitRetries?: number;
    timeoutMs?: number;
  } = {},
) {
  let attemptsRemaining = options.rateLimitRetries ?? 2;

  while (true) {
    const timeoutController = new AbortController();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TELEGRAM_API_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      timeoutController.abort(`timeout:${timeoutMs}`);
    }, timeoutMs);
    const abortSignal = mergeAbortSignals(options.signal, timeoutController.signal);

    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(params),
        signal: abortSignal,
      });
    } catch (error) {
      clearTimeout(timeout);
      if (timeoutController.signal.aborted) {
        throw new TelegramApiError(method, `request timed out after ${timeoutMs}ms`);
      }
      throw error;
    }

    clearTimeout(timeout);
    const payload = (await response.json()) as {
      ok?: boolean;
      result?: TResult;
      description?: string;
      error_code?: number;
      parameters?: {
        retry_after?: number;
      };
    };
    if (payload.ok) {
      return payload.result as TResult;
    }

    const retryAfterMs =
      payload.error_code === 429 ? getTelegramRetryAfterMs(payload) : null;
    if (retryAfterMs != null && attemptsRemaining > 0) {
      attemptsRemaining -= 1;
      await Bun.sleep(retryAfterMs);
      continue;
    }

    throw new TelegramApiError(
      method,
      payload.description ?? "",
      payload.error_code,
    );
  }
}

function mergeAbortSignals(...signals: Array<AbortSignal | undefined>) {
  const activeSignals = signals.filter((signal) => signal != null);
  if (activeSignals.length === 0) {
    return undefined;
  }

  if (activeSignals.length === 1) {
    return activeSignals[0];
  }

  const controller = new AbortController();
  for (const signal of activeSignals) {
    if (signal!.aborted) {
      controller.abort(signal!.reason);
      return controller.signal;
    }

    signal!.addEventListener(
      "abort",
      () => {
        controller.abort(signal!.reason);
      },
      { once: true },
    );
  }

  return controller.signal;
}
