import type { AuthServer } from "../auth/server.js";
import type { HubDeviceAccess } from "./index.js";

/** Account actions authorize the signed-in account, independently of instance-operator controls. */
export async function accountDeviceOperation(
  path: string,
  request: Request,
  auth: AuthServer,
  devices: HubDeviceAccess,
): Promise<Response | undefined> {
  if (path === "/google/challenge" || path === "/google/sign-in")
    return devices.completeAccountLogin(
      request,
      await devices.googleLogin.handle(path, request, auth, devices),
    );
  if (path === "/account/sessions" && request.method === "GET")
    return Response.json(await devices.accountSessions.list(await auth.resolveAccount(request)));
  const session = /^\/account\/sessions\/([a-zA-Z0-9_-]+)$/.exec(path);
  if (session && request.method === "DELETE") {
    await devices.accountSessions.revoke(await auth.resolveAccount(request), session[1]!);
    return Response.json({ ok: true });
  }
  return undefined;
}
