const ZALO_BOT_API_BASE = "https://bot-api.zaloplatforms.com";

type ZaloBotApiEnvelope<TResult> = {
  ok?: boolean;
  result?: TResult;
  error_code?: number;
  description?: string;
};

export class ZaloBotApiError extends Error {
  constructor(
    message: string,
    readonly errorCode?: number,
    readonly description?: string,
  ) {
    super(message);
    this.name = "ZaloBotApiError";
  }

  get isPollingTimeout() {
    return this.errorCode === 408;
  }
}

async function parseEnvelope<TResult>(response: Response) {
  let payload: ZaloBotApiEnvelope<TResult>;
  try {
    payload = (await response.json()) as ZaloBotApiEnvelope<TResult>;
  } catch {
    throw new ZaloBotApiError(
      `Zalo Bot API returned a non-JSON response (HTTP ${response.status}).`,
      response.status,
    );
  }

  if (!response.ok || !payload.ok) {
    throw new ZaloBotApiError(
      payload.description ?? `Zalo Bot API request failed (HTTP ${response.status}).`,
      payload.error_code ?? response.status,
      payload.description,
    );
  }

  return payload.result as TResult;
}

export async function callZaloBotApi<TResult>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
  timeoutMs?: number,
) {
  const controller = new AbortController();
  const timer = timeoutMs
    ? setTimeout(() => controller.abort(), timeoutMs)
    : undefined;

  try {
    const response = await fetch(`${ZALO_BOT_API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    return await parseEnvelope<TResult>(response);
  } catch (error) {
    if (error instanceof ZaloBotApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ZaloBotApiError("Zalo Bot API request timed out.", 408, "Request timed out");
    }
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export type ZaloBotUser = {
  id: string;
  name?: string;
  display_name?: string;
  avatar?: string;
  is_bot?: boolean;
};

export type ZaloBotMessage = {
  message_id: string;
  from: ZaloBotUser;
  chat: {
    id: string;
    chat_type: "PRIVATE" | "GROUP";
  };
  date: number;
  text?: string;
  caption?: string;
  photo_url?: string;
  sticker?: string;
  message_type?: string;
};

export type ZaloBotUpdate = {
  event_name:
    | "message.text.received"
    | "message.image.received"
    | "message.sticker.received"
    | "message.unsupported.received";
  message?: ZaloBotMessage;
};

export type ZaloBotInfo = {
  id: string;
  name?: string;
  avatar?: string;
};

export function getZaloBotMe(token: string) {
  return callZaloBotApi<ZaloBotInfo>(token, "getMe");
}

export function getZaloBotUpdates(params: {
  token: string;
  timeoutSeconds: number;
}) {
  return callZaloBotApi<ZaloBotUpdate | ZaloBotUpdate[]>(
    params.token,
    "getUpdates",
    {
      timeout: String(params.timeoutSeconds),
    },
    (params.timeoutSeconds + 5) * 1000,
  );
}

export function sendZaloBotMessage(params: {
  token: string;
  chatId: string;
  text: string;
}) {
  return callZaloBotApi<{ message_id: string }>(params.token, "sendMessage", {
    chat_id: params.chatId,
    text: params.text,
  });
}

export function sendZaloBotPhoto(params: {
  token: string;
  chatId: string;
  photoUrl: string;
  caption?: string;
}) {
  return callZaloBotApi<{ message_id: string }>(params.token, "sendPhoto", {
    chat_id: params.chatId,
    photo: params.photoUrl,
    ...(params.caption ? { caption: params.caption } : {}),
  });
}

export function sendZaloBotChatAction(params: {
  token: string;
  chatId: string;
  action: "typing";
}) {
  return callZaloBotApi<true>(params.token, "sendChatAction", {
    chat_id: params.chatId,
    action: params.action,
  });
}

export function setZaloBotWebhook(params: {
  token: string;
  url: string;
  secretToken: string;
}) {
  return callZaloBotApi(params.token, "setWebhook", {
    url: params.url,
    secret_token: params.secretToken,
  });
}

export function deleteZaloBotWebhook(params: {
  token: string;
}) {
  return callZaloBotApi(params.token, "deleteWebhook");
}

export function getZaloBotWebhookInfo(params: {
  token: string;
}) {
  return callZaloBotApi<{
    url?: string;
    updated_at?: number;
  }>(params.token, "getWebhookInfo");
}
