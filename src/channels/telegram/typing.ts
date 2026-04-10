export const TELEGRAM_TYPING_HEARTBEAT_MS = 4_500;

function logTelegramTypingError(
  onError: ((error: unknown) => void) | undefined,
  error: unknown,
) {
  onError?.(error);
}

function startTelegramTypingHeartbeat(params: {
  sendTyping: () => Promise<void>;
  intervalMs: number;
  onError?: (error: unknown) => void;
}) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const scheduleNext = () => {
    timer = setTimeout(async () => {
      if (stopped) {
        return;
      }
      try {
        await params.sendTyping();
      } catch (error) {
        logTelegramTypingError(params.onError, error);
      }
      if (!stopped) {
        scheduleNext();
      }
    }, params.intervalMs);
  };

  scheduleNext();
  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}

export async function runWithTelegramTypingHeartbeat<T>(params: {
  sendTyping: () => Promise<void>;
  run: () => Promise<T>;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}) {
  try {
    await params.sendTyping();
  } catch (error) {
    logTelegramTypingError(params.onError, error);
  }

  const stopHeartbeat = startTelegramTypingHeartbeat({
    sendTyping: params.sendTyping,
    intervalMs: params.intervalMs ?? TELEGRAM_TYPING_HEARTBEAT_MS,
    onError: params.onError,
  });

  try {
    return await params.run();
  } finally {
    stopHeartbeat();
  }
}
