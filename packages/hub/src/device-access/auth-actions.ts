import type { AuthServer } from "../auth/server.js";
import type { HubDeviceAccess } from "./index.js";
import { DeviceAccessError } from "@clisbot/device-access/authority";

export function pairedLoginActions(
  server: AuthServer,
  devices: HubDeviceAccess,
): Partial<AuthServer> {
  return {
    ...pairedEmailActions(server, devices),
    ...pairedSetupAction(server, devices),
    ...pairedAccountActions(server, devices),
  };
}

function pairedEmailActions(server: AuthServer, devices: HubDeviceAccess): Partial<AuthServer> {
  return {
    ...(server.signInEmail
      ? {
          async signInEmail(data: { email: string; password: string }, headers: Headers) {
            const request = await requirePairedAction(
              devices,
              headers,
              "/api/auth/sign-in/email",
              data,
            );
            await devices.withRequest(request, () => server.signInEmail!(data, headers));
          },
        }
      : {}),
    ...(server.signUpEmail
      ? {
          async signUpEmail(
            data: { name: string; email: string; password: string },
            headers: Headers,
            invitationId?: string,
          ) {
            const request = await requirePairedAction(
              devices,
              headers,
              "/api/auth/sign-up/email",
              data,
            );
            await devices.withRequest(request, () =>
              server.signUpEmail!(data, headers, invitationId),
            );
          },
        }
      : {}),
  };
}

function pairedSetupAction(server: AuthServer, devices: HubDeviceAccess): Partial<AuthServer> {
  return server.claimInstance
    ? {
        async claimInstance(
          operator: import("../instance-setup/index.js").InitialOperator,
          headers: Headers,
        ) {
          const request = await requirePairedAction(
            devices,
            headers,
            "/api/auth/clisbot/claim-instance",
            operator,
          );
          return devices.withRequest(request, () => server.claimInstance!(operator, headers));
        },
      }
    : {};
}

function pairedAccountActions(server: AuthServer, devices: HubDeviceAccess): Partial<AuthServer> {
  return {
    ...(server.signOut
      ? {
          async signOut(headers: Headers) {
            const request = await requirePairedAction(devices, headers, "/api/auth/sign-out", {});
            await devices.withRequest(request, async () => {
              const account = await server.resolveAccount(request);
              await devices.accountSessions.revoke(account, account.session.id);
              await server.signOut!(headers);
            });
          },
        }
      : {}),
    ...(server.changePassword
      ? {
          async changePassword(
            data: { currentPassword: string; newPassword: string },
            headers: Headers,
          ) {
            const request = await requirePairedAction(
              devices,
              headers,
              "/api/auth/change-password",
              data,
            );
            await devices.withRequest(request, () => server.changePassword!(data, request.headers));
          },
        }
      : {}),
  };
}

async function requirePairedAction(
  devices: HubDeviceAccess,
  headers: Headers,
  path: string,
  body: object,
): Promise<Request> {
  const request = new Request(`http://paired-hub.invalid${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!(await devices.prepare(request)))
    throw new DeviceAccessError("Paired device required before account login");
  return request;
}
