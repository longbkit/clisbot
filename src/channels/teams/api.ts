const TEAMS_TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token";
const TEAMS_TOKEN_SCOPE = "https://api.botframework.com/.default";
const TEAMS_API_TIMEOUT_MS = 10_000;

type TeamsOAuthToken = {
  access_token: string;
  expires_in: number;
  acquiredAt: number;
};

const teamsTokenCache = new Map<string, TeamsOAuthToken>();

export async function acquireTeamsToken(
  appId: string,
  appPassword: string,
): Promise<string> {
  const cacheKey = `${appId}:${appPassword}`;
  const cached = teamsTokenCache.get(cacheKey);
  const now = Date.now();

  if (cached) {
    const expiresAt = cached.acquiredAt + (cached.expires_in - 60) * 1000;
    if (now < expiresAt) {
      return cached.access_token;
    }
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: appId,
    client_secret: appPassword,
    scope: TEAMS_TOKEN_SCOPE,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEAMS_API_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(TEAMS_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Teams OAuth token request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    throw new Error("Teams OAuth token response missing access_token");
  }

  const token: TeamsOAuthToken = {
    access_token: data.access_token,
    expires_in: data.expires_in ?? 3600,
    acquiredAt: now,
  };
  teamsTokenCache.set(cacheKey, token);
  return token.access_token;
}

export async function sendTeamsActivity(params: {
  appId: string;
  appPassword: string;
  serviceUrl: string;
  conversationId: string;
  activity: Record<string, unknown>;
}): Promise<{ id: string }> {
  const token = await acquireTeamsToken(params.appId, params.appPassword);
  const serviceUrl = params.serviceUrl.replace(/\/$/, "");
  const url = `${serviceUrl}/v3/conversations/${encodeURIComponent(params.conversationId)}/activities`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEAMS_API_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params.activity),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Teams sendActivity failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { id?: string };
  return { id: data.id ?? "" };
}

export async function updateTeamsActivity(params: {
  appId: string;
  appPassword: string;
  serviceUrl: string;
  conversationId: string;
  activityId: string;
  activity: Record<string, unknown>;
}): Promise<void> {
  const token = await acquireTeamsToken(params.appId, params.appPassword);
  const serviceUrl = params.serviceUrl.replace(/\/$/, "");
  const url = `${serviceUrl}/v3/conversations/${encodeURIComponent(params.conversationId)}/activities/${encodeURIComponent(params.activityId)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEAMS_API_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params.activity),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Teams updateActivity failed (${response.status}): ${text}`);
  }
}

export async function deleteTeamsActivity(params: {
  appId: string;
  appPassword: string;
  serviceUrl: string;
  conversationId: string;
  activityId: string;
}): Promise<void> {
  const token = await acquireTeamsToken(params.appId, params.appPassword);
  const serviceUrl = params.serviceUrl.replace(/\/$/, "");
  const url = `${serviceUrl}/v3/conversations/${encodeURIComponent(params.conversationId)}/activities/${encodeURIComponent(params.activityId)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEAMS_API_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Teams deleteActivity failed (${response.status}): ${text}`);
  }
}

export async function getTeamsConversationMembers(params: {
  appId: string;
  appPassword: string;
  serviceUrl: string;
  conversationId: string;
}): Promise<Array<{ id: string; name?: string }>> {
  const token = await acquireTeamsToken(params.appId, params.appPassword);
  const serviceUrl = params.serviceUrl.replace(/\/$/, "");
  const url = `${serviceUrl}/v3/conversations/${encodeURIComponent(params.conversationId)}/members`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEAMS_API_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Teams getConversationMembers failed (${response.status}): ${text}`);
  }

  return (await response.json()) as Array<{ id: string; name?: string }>;
}
