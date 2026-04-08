type SlackAssistantStatusClient = {
  assistant?: {
    threads?: {
      setStatus(args: {
        channel_id: string;
        thread_ts: string;
        status: string;
        loading_messages?: string[];
      }): Promise<unknown>;
    };
  };
};

type SlackAssistantStatusConfig = {
  enabled: boolean;
  status: string;
  loadingMessages: string[];
};

const loggedAssistantStatusWarnings = new Set<string>();

function logSlackAssistantStatusWarningOnce(message: string) {
  if (loggedAssistantStatusWarnings.has(message)) {
    return;
  }

  loggedAssistantStatusWarnings.add(message);
  console.warn(message);
}

function getSlackAssistantStatusErrorMetadata(error: unknown) {
  if (!error || typeof error !== "object") {
    return {};
  }

  const candidate = error as {
    data?: { error?: unknown; needed?: unknown };
    code?: unknown;
  };
  return {
    platformError: candidate.data?.error,
    neededScope: candidate.data?.needed,
    code: candidate.code,
  };
}

export function buildSlackAssistantStatusRequest(
  config: SlackAssistantStatusConfig,
  target: { channel: string; threadTs?: string },
) {
  const status = config.status.trim();
  const loadingMessages = config.loadingMessages
    .map((message) => message.trim())
    .filter((message) => message.length > 0);

  if (!config.enabled || !target.threadTs || !status) {
    return null;
  }

  return {
    channel_id: target.channel,
    thread_ts: target.threadTs,
    status,
    ...(loadingMessages.length > 0
      ? { loading_messages: loadingMessages }
      : {}),
  };
}

export async function setSlackAssistantThreadStatus(
  client: SlackAssistantStatusClient,
  config: SlackAssistantStatusConfig,
  target: { channel: string; threadTs?: string },
) {
  const request = buildSlackAssistantStatusRequest(config, target);
  if (!request) {
    return false;
  }

  if (!client.assistant?.threads?.setStatus) {
    logSlackAssistantStatusWarningOnce(
      "slack assistant status unavailable: client does not support assistant.threads.setStatus",
    );
    return false;
  }

  try {
    await client.assistant.threads.setStatus(request);
    return true;
  } catch (error) {
    const metadata = getSlackAssistantStatusErrorMetadata(error);
    if (
      metadata.platformError === "missing_scope" &&
      typeof metadata.neededScope === "string"
    ) {
      logSlackAssistantStatusWarningOnce(
        `slack assistant status disabled: missing scope ${metadata.neededScope}`,
      );
      return false;
    }
    console.error("slack assistant status failed", error);
    return false;
  }
}
