import { z } from "zod";
import type { AuthServer } from "../auth/server.js";
import type { HubDeviceAccess } from "./index.js";
import { DeviceAccessError } from "@clisbot/device-access/authority";
import { ProductRequestError } from "../auth/organization-access.js";
import { reportFailure } from "../failures/index.js";

import { pairedLoginActions } from "./auth-actions.js";
import { accountDeviceOperation } from "./account-routes.js";
import { boundedBody } from "./request-body.js";

const PREFIX = "/api/auth/clisbot/device";

export function withDeviceAccess(server: AuthServer, devices: HubDeviceAccess): AuthServer {
  return {
    ...server,
    ...pairedAccountAccess(server, devices),
    ...pairedLoginActions(server, devices),
    deviceId: (request) => devices.deviceId(request),
    deviceSocket: (request, id, disconnect) =>
      registerDeviceSocket(server, devices, request, id, disconnect),
    handle: (request) =>
      devices
        .withRequest(request, () => handleDeviceAuth(server, devices, request))
        .catch(deviceErrorResponse),
  };
}

async function registerDeviceSocket(
  auth: AuthServer,
  devices: HubDeviceAccess,
  request: Request,
  id: string,
  disconnect: () => void,
): Promise<() => void> {
  const deviceId = await devices.deviceId(request);
  if (!deviceId) throw new DeviceAccessError("Paired device required");
  if (deviceId.startsWith("login:")) return () => undefined;
  const account = await auth.resolveAccount(request).catch(() => undefined);
  const release = devices.connections.register(deviceId, id, disconnect, account?.session.id);
  if (
    !(await devices.authority.list()).some(
      (device) => device.id === deviceId && device.revokedAt === null,
    )
  ) {
    release();
    disconnect();
    throw new DeviceAccessError("Device revoked");
  }
  return release;
}

async function handleDeviceAuth(
  server: AuthServer,
  devices: HubDeviceAccess,
  request: Request,
): Promise<Response> {
  try {
    const path = new URL(request.url).pathname;
    if (path === `${PREFIX}/identity` && request.method === "GET")
      return await identity(server, devices);
    if (path === "/api/auth/jwks") return await server.handle(request);
    if (path === `${PREFIX}/redeem`) return await devices.redeem(request);
    if (path === `${PREFIX}/login-challenge` && request.method === "POST")
      return await loginChallenge(request, devices);
    if (path.startsWith(`${PREFIX}/`) && devices.isLocalOperator(request))
      return await deviceOperation(request, server, devices, true);
    if (!(await devices.prepare(request))) return pairingRequired();
    if (path.startsWith(`${PREFIX}/`)) return await deviceOperation(request, server, devices);
    if (path === "/api/auth/sign-in/social" || path === "/api/auth/callback/google")
      return Response.json({ error: "device_google_login_required" }, { status: 403 });
    if (path === "/api/auth/sign-out" && request.method === "POST") {
      const account = await server.resolveAccount(request);
      await devices.accountSessions.revoke(account, account.session.id);
    }
    return await devices.completeAccountLogin(request, await server.handle(request));
  } catch (error) {
    return deviceErrorResponse(error);
  }
}

function pairedAccountAccess(server: AuthServer, devices: HubDeviceAccess): Partial<AuthServer> {
  return {
    async resolveOrganizationAccess(request) {
      await devices.prepare(request);
      return server.resolveOrganizationAccess(request);
    },
    async resolveAccount(request) {
      await devices.prepare(request);
      return server.resolveAccount(request);
    },
    async resources(request, organizations) {
      await devices.prepare(request);
      return server.resources(request, organizations);
    },
    async browserAccount(request) {
      try {
        await devices.prepare(request);
        return await server.browserAccount!(request);
      } catch {
        return pairingRequired();
      }
    },
    async initialize() {
      await server.initialize?.();
    },
  };
}

async function identity(auth: AuthServer, devices: HubDeviceAccess): Promise<Response> {
  const info = await devices.authority.info();
  const setupStatus = await devices.setupStatus();
  let entry = "pairing";
  if (info.loginRequired) entry = setupStatus === "ready" ? "account" : "owner-setup";
  return Response.json(
    {
      hubId: info.backendId,
      devicePairing: true,
      loginRequired: info.loginRequired,
      publicKey: await devices.publicKey,
      relay: devices.relay,
      setupStatus,
      entry,
      providers: {
        google: {
          enabled: !!auth.googleClientId,
          ...(auth.googleClientId ? { clientId: auth.googleClientId } : {}),
        },
      },
    },
    { headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } },
  );
}

async function loginChallenge(request: Request, devices: HubDeviceAccess): Promise<Response> {
  const info = await devices.authority.info();
  if (!info.loginRequired || (await devices.setupStatus()) !== "ready")
    return Response.json({ error: "account_entry_unavailable" }, { status: 403 });
  const body = z
    .object({ publicKey: z.string().max(128), label: z.string().max(80).optional() })
    .strict()
    .parse(JSON.parse(await boundedBody(request, 2048)));
  return Response.json(devices.loginEntry.create(info.backendId, body.publicKey, body.label), {
    headers: { "cache-control": "no-store" },
  });
}

async function deviceOperation(
  request: Request,
  auth: AuthServer,
  devices: HubDeviceAccess,
  localOperator = false,
): Promise<Response> {
  const path = new URL(request.url).pathname.slice(PREFIX.length);
  const accountOperation = await accountDeviceOperation(path, request, auth, devices);
  if (accountOperation) return accountOperation;
  if (path === "/enrollment-token" && request.method === "POST")
    return enrollmentToken(devices, localOperator);
  if (path === "/capabilities" && request.method === "GET")
    return deviceCapabilities(request, auth, devices);
  if (!localOperator && !(await auth.resolveAccount(request)).isInstanceOperator)
    return Response.json({ error: "instance_operator_required" }, { status: 403 });
  if (path === "/invitations" && request.method === "POST")
    return createInvitation(request, devices);
  if (path === "/setup-grants" && request.method === "POST")
    return createSetupApproval(request, devices);
  if (path === "/devices" && request.method === "GET")
    return Response.json({
      devices: (await devices.authority.list()).map((device) =>
        Object.assign({}, device, { sessions: devices.connections.sessions(device.id) }),
      ),
    });
  if (path === "/login-policy" && request.method === "PUT") {
    const body = z
      .object({ required: z.boolean() })
      .strict()
      .parse(await request.json());
    await devices.setLoginRequired(body.required);
    return Response.json({ loginRequired: body.required });
  }
  if (path === "/owner-login" && request.method === "POST")
    return attachOwnerLogin(request, devices);
  return deviceMutation(request, path, devices);
}

async function createSetupApproval(request: Request, devices: HubDeviceAccess): Promise<Response> {
  if ((await devices.setupStatus()) !== "owner-required")
    return Response.json({ error: "owner_setup_unavailable" }, { status: 409 });
  const body = z
    .object({ deviceId: z.string().uuid(), ttlMs: z.number().int().optional() })
    .strict()
    .parse(await request.json());
  if (
    !(await devices.authority.list()).some(
      (device) => device.id === body.deviceId && device.revokedAt === null,
    )
  )
    return Response.json({ error: "device_not_found" }, { status: 404 });
  return Response.json(
    await devices.ownerSetup.create({
      hubId: (await devices.authority.info()).backendId,
      deviceId: body.deviceId,
      ...(body.ttlMs === undefined ? {} : { ttlMs: body.ttlMs }),
    }),
  );
}

async function deviceMutation(
  request: Request,
  path: string,
  devices: HubDeviceAccess,
): Promise<Response> {
  const match = /^\/devices\/([a-zA-Z0-9-]+)$/.exec(path);
  if (!match) return Response.json({ error: "not_found" }, { status: 404 });
  const id = match[1]!;
  if (request.method === "PATCH") {
    const body = z
      .object({ label: z.string().max(80) })
      .strict()
      .parse(await request.json());
    await devices.authority.rename(id, body.label);
  } else if (request.method === "DELETE") await devices.revoke(id);
  else return Response.json({ error: "method_not_allowed" }, { status: 405 });
  return Response.json({ ok: true });
}

function pairingRequired(): Response {
  return Response.json({ error: "paired_device_required" }, { status: 401 });
}

function deviceErrorResponse(error: unknown): Response {
  if (error instanceof ProductRequestError) return error.response();
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return Response.json({ error: "invalid_request" }, { status: 400 });
  if (error instanceof DeviceAccessError)
    return Response.json({ error: "device_access_denied" }, { status: 401 });
  reportFailure(error, { operation: "auth.device.request", component: "auth" });
  return Response.json({ error: "device_access_unavailable" }, { status: 503 });
}

async function deviceCapabilities(
  request: Request,
  auth: AuthServer,
  devices: HubDeviceAccess,
): Promise<Response> {
  const info = await devices.authority.info();
  const account = await auth.resolveOrganizationAccess(request).catch(() => undefined);
  const operator = await auth.resolveAccount(request).then(
    (value) => value.isInstanceOperator,
    () => false,
  );
  return Response.json({
    hubId: info.backendId,
    paired: true,
    loginRequired: info.loginRequired,
    accountAuthentication: accountAuthentication(account?.session.id),
    canManageDevices: operator,
    canConfigureLogin: operator,
    ...(operator ? { ownerLoginConfigured: await devices.ownerLoginConfigured() } : {}),
    organization: account?.organization ?? null,
    capabilities: account?.capabilities ?? null,
  });
}

async function enrollmentToken(
  devices: HubDeviceAccess,
  localOperator: boolean,
): Promise<Response> {
  if (!localOperator) return Response.json({ error: "local_operator_required" }, { status: 403 });
  if ((await devices.authority.info()).loginRequired || !devices.localEnrollment)
    return Response.json({ error: "personal_enrollment_unavailable" }, { status: 409 });
  return Response.json({ token: await devices.localEnrollment() }, { status: 201 });
}

async function createInvitation(request: Request, devices: HubDeviceAccess): Promise<Response> {
  const body = z
    .object({ label: z.string().max(80).optional(), ttlMs: z.number().int().optional() })
    .strict()
    .parse(await request.json());
  return Response.json(
    await devices.createInvitation({
      ...(body.label === undefined ? {} : { label: body.label }),
      ...(body.ttlMs === undefined ? {} : { ttlMs: body.ttlMs }),
    }),
  );
}

async function attachOwnerLogin(request: Request, devices: HubDeviceAccess): Promise<Response> {
  const body = z
    .object({
      email: z.email().max(254),
      password: z.string().min(12).max(128),
      name: z.string().min(1).max(100).optional(),
    })
    .strict()
    .parse(await request.json());
  await devices.attachOwnerLogin({
    email: body.email,
    password: body.password,
    ...(body.name === undefined ? {} : { name: body.name }),
  });
  return Response.json({ ok: true });
}

function accountAuthentication(sessionId?: string): "personal" | "signedIn" | "required" {
  if (!sessionId) return "required";
  return sessionId.startsWith("device:") ? "personal" : "signedIn";
}
