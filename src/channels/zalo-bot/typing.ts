export const ZALO_BOT_TYPING_HEARTBEAT_MS = 4_500;

function logZaloBotTypingError(
  onError: ((error: unknown) => void) | undefined,
  error: unknown,
) {
  onError?.(error);
}

function startZaloBotTypingHeartbeat(params: {
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
        logZaloBotTypingError(params.onError, error);
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

export async function beginZaloBotTypingHeartbeat(params: {
  sendTyping: () => Promise<void>;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}) {
  try {
    await params.sendTyping();
  } catch (error) {
    logZaloBotTypingError(params.onError, error);
  }

  return startZaloBotTypingHeartbeat({
    sendTyping: params.sendTyping,
    intervalMs: params.intervalMs ?? ZALO_BOT_TYPING_HEARTBEAT_MS,
    onError: params.onError,
  });
}
