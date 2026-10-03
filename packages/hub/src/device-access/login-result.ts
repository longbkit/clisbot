import { DeviceAccessError } from "@clisbot/device-access/authority";
import type { DatabaseRuntime } from "../db/runtime/index.js";

/** Only a session cookie issued by Better Auth in this response can bind a successful login. */
export async function issuedAccountSession(database: DatabaseRuntime, response: Response) {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.split("=")[0]?.endsWith("session_token"));
  if (!cookie) return undefined;
  const token = decodeURIComponent(cookie.split(";")[0]!.slice(cookie.indexOf("=") + 1)).split(
    ".",
  )[0];
  const result = await database.query<{ id: string; userId: string; expiresAt: Date }>(
    `select id, user_id as "userId", expires_at as "expiresAt" from session where token = $1 and expires_at > now()`,
    [token],
  );
  if (!result.rows[0]) throw new DeviceAccessError("Account login session unavailable");
  return result.rows[0];
}

export function deviceCredentialResponse(
  response: Response,
  backendId: string,
  credentialId: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set("x-clisbot-device-credential", JSON.stringify({ backendId, credentialId }));
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}
