import { z } from "zod";
import {
  DeviceAuthority,
  DeviceAccessError,
  type PairedDevice,
} from "@clisbot/device-access/authority";
import { httpBinding } from "@clisbot/device-access/proof";
import { DeviceProofSchema } from "@clisbot/protocol/device-access";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import type { AccountSession } from "../auth/organization-access.js";
import type { ProvisioningEntitlement } from "../organizations/provisioning.js";
import { HubDeviceAuthorityStore } from "./store.js";
import { bootstrapPersonalOwner, personalOwnerSession } from "./personal-owner.js";
import { ProductRequestError } from "../auth/organization-access.js";
import { InstanceAppOnboarding } from "../instance-setup/app-onboarding.js";
import type { RevokedAccessLease } from "../managed-access/tickets.js";
import { matchesLocalControlCredential } from "@clisbot/device-access/local-control";
import { attachPersonalOwnerLogin } from "./owner-login.js";
import { DeviceConnections } from "./connections.js";
import { AsyncLocalStorage } from "node:async_hooks";
import type { TransactionHandle } from "../db/runtime/index.js";
import { OwnerSetupApprovals } from "./owner-setup.js";
import { HubLoginEntry } from "./login-entry.js";
import { HubGoogleLogin } from "./google-login.js";
import { HubAccountSessions } from "./account-sessions.js";
import { readInstanceSetupStatus } from "../instance-setup/index.js";
import { issuedAccountSession, deviceCredentialResponse } from "./login-result.js";
import { boundedBody } from "./request-body.js";
import { EMAIL_REGISTRATION_PATHS } from "../auth/registration-contract.js";

interface PreparedDevice {
  device: PairedDevice;
  loginRequired: boolean;
}

export class HubDeviceAccess {
  readonly authority: DeviceAuthority;
  readonly connections = new DeviceConnections();
  readonly ownerSetup: OwnerSetupApprovals;
  readonly loginEntry = new HubLoginEntry();
  readonly googleLogin = new HubGoogleLogin();
  readonly accountSessions: HubAccountSessions;
  private readonly prepared = new WeakMap<Headers, Promise<PreparedDevice | null>>();
  private readonly requestContext = new AsyncLocalStorage<Request>();

  constructor(
    private readonly database: DatabaseRuntime,
    initialLoginRequired = true,
    private readonly notifyRevocation: (leases: RevokedAccessLease[]) => Promise<void> = () =>
      Promise.resolve(),
    private readonly operatorCredential?: string,
    readonly publicKey?: Promise<string>,
    readonly relay?: { endpoint: string; useTls: boolean },
    readonly localEnrollment?: () => Promise<string>,
  ) {
    this.authority = new DeviceAuthority(
      new HubDeviceAuthorityStore(database, initialLoginRequired),
    );
    this.ownerSetup = new OwnerSetupApprovals(database);
    this.accountSessions = new HubAccountSessions(database, this.connections, notifyRevocation);
  }

  withRequest<T>(request: Request, operation: () => Promise<T>): Promise<T> {
    return this.requestContext.run(request, async () => {
      if (!request.headers.has("x-clisbot-device-proof")) return operation();
      const prepared = await this.prepare(request);
      if (
        prepared?.device.id.startsWith("login:") &&
        this.loginEntry.requiresMutationGuard(request)
      )
        return this.loginEntry.runMutation(prepared.device.id, operation);
      return operation();
    });
  }

  async checkOwnerSetupApproval(request: Request): Promise<void> {
    const deviceId = await this.deviceId(request);
    if (!deviceId || deviceId.startsWith("login:"))
      throw new ProductRequestError(403, "owner_setup_approval_required");
    await this.ownerSetup.check({
      token: request.headers.get("x-clisbot-owner-setup"),
      hubId: (await this.authority.info()).backendId,
      deviceId,
    });
  }

  async completeAccountLogin(request: Request, response: Response): Promise<Response> {
    if (
      !response.ok ||
      request.method !== "POST" ||
      ![
        "/api/auth/sign-in/email",
        "/api/auth/sign-up/email",
        EMAIL_REGISTRATION_PATHS.complete,
        "/api/auth/clisbot/device/google/sign-in",
        "/api/auth/clisbot/claim-instance",
      ].includes(new URL(request.url).pathname)
    )
      return response;
    const prepared = await this.prepare(request);
    if (!prepared) return response;
    const session = await issuedAccountSession(this.database, response);
    if (!session) return response;
    const ephemeral = prepared.device.id.startsWith("login:");
    const device = ephemeral
      ? await this.authority.registerLoginDevice({
          publicKey: prepared.device.publicKey,
          label: prepared.device.label,
        })
      : prepared.device;
    await this.accountSessions.associate(session, device.id);
    if (ephemeral) this.loginEntry.consume(prepared.device.id);
    return deviceCredentialResponse(response, (await this.authority.info()).backendId, device.id);
  }

  /** Server actions receive Better Auth headers directly instead of an HTTP response. */
  async completeAccountAction(headers: Headers): Promise<void> {
    const request = this.requestContext.getStore();
    if (!request) throw new DeviceAccessError("Verified device request required");
    await this.completeAccountLogin(request, new Response(null, { headers }));
  }

  async authorizeOwnerSetup(transaction: TransactionHandle): Promise<void> {
    const request = this.requestContext.getStore();
    const deviceId = request ? await this.deviceId(request) : undefined;
    if (!request || !deviceId) throw new ProductRequestError(403, "owner_setup_approval_required");
    const state = await transaction.query<{ hubId: string; active: boolean }>(
      `select state->>'backendId' as "hubId", exists
       (select 1 from jsonb_array_elements(state->'devices') d
        where d->>'id' = $1 and d->>'revokedAt' is null) as active
       from device_authority where singleton = true for update`,
      [deviceId],
    );
    if (!state.rows[0]?.active) throw new ProductRequestError(403, "owner_setup_approval_required");
    await this.ownerSetup.consume(transaction, {
      token: request.headers.get("x-clisbot-owner-setup"),
      hubId: state.rows[0].hubId,
      deviceId,
    });
  }

  async setupStatus(): Promise<"ready" | "owner-required" | "blocked"> {
    const status = await readInstanceSetupStatus(this.database);
    if (status === "claimed") return "ready";
    return status === "available" ? "owner-required" : "blocked";
  }

  async initialize(entitlement: ProvisioningEntitlement): Promise<void> {
    const info = await this.authority.info();
    if (!info.loginRequired) {
      await bootstrapPersonalOwner(this.database, entitlement);
      await new InstanceAppOnboarding(this.database).complete();
    }
  }

  isLocalOperator(request: Request): boolean {
    return matchesLocalControlCredential(
      this.operatorCredential,
      request.headers.get("authorization"),
    );
  }

  attachOwnerLogin(input: { email: string; password: string; name?: string }): Promise<void> {
    return attachPersonalOwnerLogin(this.database, input);
  }

  prepare(request: Request): Promise<PreparedDevice | null> {
    let prepared = this.prepared.get(request.headers);
    if (!prepared) {
      prepared = this.authenticate(request);
      this.prepared.set(request.headers, prepared);
    }
    return prepared;
  }

  async deviceId(request: Request): Promise<string | undefined> {
    return (await this.prepare(request))?.device.id;
  }

  async resolveSession(
    headers: Headers,
    account: AccountSession | undefined,
  ): Promise<AccountSession | undefined> {
    const prepared = await this.prepared.get(headers);
    if (!prepared) return undefined;
    if (
      !(await this.authority.list()).some(
        (device) => device.id === prepared.device.id && device.revokedAt === null,
      )
    )
      return undefined;
    const { loginRequired } = await this.authority.info();
    if (account) {
      const association = await this.database.query<{ deviceId: string }>(
        `select value::jsonb->>'deviceId' as "deviceId" from verification where identifier = $1`,
        ["clisbot:session-device:" + account.sessionId],
      );
      if (association.rows[0]?.deviceId !== prepared.device.id) return undefined;
      await this.accountSessions.touch(account.sessionId, prepared.device.id);
      return account;
    }
    if (loginRequired || prepared.device.grant !== "owner") return undefined;
    return await personalOwnerSession(this.database, prepared.device.id);
  }

  async createInvitation(
    options: { label?: string; ttlMs?: number } = {},
  ): Promise<{ backendId: string; token: string; expiresAt: number; ownerSetupToken?: string }> {
    const info = await this.authority.info();
    const invitation = await this.authority.createInvitation({
      ...options,
      grant: info.loginRequired ? "login" : "owner",
    });
    if ((await this.setupStatus()) !== "owner-required") return invitation;
    const approval = await this.ownerSetup.create({
      hubId: info.backendId,
      invitationToken: invitation.token,
      ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
    });
    return { ...invitation, ownerSetupToken: approval.ownerSetupToken };
  }

  async redeem(request: Request): Promise<Response> {
    if (request.method !== "POST")
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    const text = await boundedBody(request, 4096);
    const body = z
      .object({
        token: z.string().length(43),
        publicKey: z.string().max(128),
        label: z.string().max(80).optional(),
        proof: DeviceProofSchema,
      })
      .strict()
      .parse(JSON.parse(text));
    const device = await this.authority.redeem({
      token: body.token,
      publicKey: body.publicKey,
      proof: body.proof,
      ...(body.label === undefined ? {} : { label: body.label }),
    });
    await this.ownerSetup.bindInvitation(body.token, device.id);
    const info = await this.authority.info();
    return Response.json({
      hubId: info.backendId,
      credentialId: device.id,
      loginRequired: info.loginRequired,
    });
  }

  async ownerLoginConfigured(): Promise<boolean> {
    const owner = await this.database.query(`select d.personal_user_id, exists
      (select 1 from account a where a.user_id = d.personal_user_id) as linked
      from device_authority d where singleton = true`);
    const row = owner.rows[0];
    return !row?.["personal_user_id"] || row["linked"] === true;
  }

  async requireLoginMethod(): Promise<void> {
    if (!(await this.ownerLoginConfigured()))
      throw new ProductRequestError(409, "personal_owner_login_method_required");
  }

  async revoke(id: string): Promise<void> {
    const revoked = await this.database.transaction(async (transaction) => {
      await this.authority.revoke(id);
      const accountLeases = await this.accountSessions.removeDeviceSessions(transaction, id);
      await transaction.query(
        `delete from daemon_access_tickets where device_id = $1 and consumed_at is null`,
        [id],
      );
      const leases = await transaction.query<{ id: string; daemonId: string }>(
        `update daemon_access_leases
        set revoked_at = now() where device_id = $1 and revoked_at is null
        returning id, daemon_id as "daemonId"`,
        [id],
      );
      return [...accountLeases, ...leases.rows];
    });
    this.connections.revoke(id);
    await this.notifyRevocation(revoked);
  }

  async setLoginRequired(required: boolean): Promise<void> {
    if (required) await this.requireLoginMethod();
    if (!required && !(await personalOwnerSession(this.database, "operator")))
      throw new ProductRequestError(409, "personal_owner_required");
    const revoked = await this.database.transaction(async (transaction) => {
      await this.authority.setLoginRequired(required);
      if (!required) return [];
      const leases = await transaction.query<{
        id: string;
        daemonId: string;
      }>(`update daemon_access_leases
        set revoked_at = now() where device_id is not null and revoked_at is null
        returning id, daemon_id as "daemonId"`);
      return leases.rows;
    });
    await this.notifyRevocation(revoked);
  }

  private async authenticate(request: Request): Promise<PreparedDevice | null> {
    const header = request.headers.get("x-clisbot-device-proof");
    if (!header) return null;
    if (header.length > 1024) throw new Error("Invalid device proof");
    const proof = DeviceProofSchema.parse(JSON.parse(header));
    const url = new URL(request.url);
    const body = await boundedBody(request.clone());
    const context = {
      purpose: "http",
      binding: httpBinding({ method: request.method, path: `${url.pathname}${url.search}`, body }),
    } as const;
    if (proof.credentialId.startsWith("login:")) {
      if (!(await this.authority.info()).loginRequired || (await this.setupStatus()) !== "ready")
        throw new DeviceAccessError("Account entry unavailable");
      return { device: this.loginEntry.authenticate(proof, context, request), loginRequired: true };
    }
    const device = await this.authority.authenticate(proof, context);
    return { device, loginRequired: (await this.authority.info()).loginRequired };
  }
}
