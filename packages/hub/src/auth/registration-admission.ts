import type { DatabaseRuntime, QueryHandle, TransactionHandle } from "../db/runtime/index.js";
import type { Locks } from "../db/runtime/locks/index.js";
import { z } from "zod";
import type { InstanceAuthPolicy } from "./instance-policy.js";
import { emailDomain, normalizeEmail } from "./instance-policy.js";
import { reportFailure } from "../failures/index.js";
import { runInRegistrationScope } from "./registration-scope.js";

const signupEmailBody = z.object({ email: z.string().email() }).passthrough();
const INVITATION_LOCK_PREFIX = "paseo:invitation:";

export function invitationLockName(invitationId: string): string {
  return `${INVITATION_LOCK_PREFIX}${invitationId}`;
}

/** Why a registration is admitted. Invitations always win over the domain allowlist. */
export type AdmissionDecision =
  | { kind: "open" }
  | { kind: "invitation"; invitationId: string }
  | { kind: "domain"; domain: string };

export class RegistrationAdmission {
  constructor(
    private readonly pool: DatabaseRuntime,
    private readonly locks: Locks,
    private readonly policy: InstanceAuthPolicy,
  ) {}

  async handleSignUp(
    request: Request,
    action: (request: Request) => Promise<Response>,
  ): Promise<Response> {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      return Response.json({ error: "invalid_signup" }, { status: 400 });
    }
    let requestBody: unknown;
    try {
      requestBody = await request.clone().json();
    } catch (error) {
      reportFailure(
        error,
        { operation: "auth.signup.parse", component: "auth" },
        { kind: "validation" },
      );
    }
    const body = signupEmailBody.safeParse(requestBody);
    if (!body.success) return Response.json({ error: "invalid_signup" }, { status: 400 });
    const invitationId =
      new URL(request.url).searchParams.get("invitation") ??
      (typeof body.data["invitation"] === "string" ? body.data["invitation"] : undefined);
    return this.withAdmission(body.data.email, invitationId, async () => {
      const sanitizedBody = Object.fromEntries(
        Object.entries(body.data).filter(([key]) => key !== "invitation"),
      );
      return action(
        new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify(sanitizedBody),
        }),
      );
    });
  }

  /**
   * Password signup with a password chosen up front: open registration, or an invitation link
   * (the link is the capability). Domain self-registration never takes this path; it proves the
   * email first through `EmailVerification`.
   */
  async withAdmission<T>(
    email: string,
    invitationId: string | undefined,
    action: () => Promise<T>,
  ): Promise<T> {
    if (this.policy.registrationMode === "open") return action();
    if (invitationId === undefined) throw new RegistrationAdmissionError();
    return this.locks.withLock(invitationLockName(invitationId), async () => {
      if (!(await this.isInvited(email, invitationId))) {
        throw new RegistrationAdmissionError();
      }
      await this.requireNewEmail(email);
      return runInRegistrationScope({ passwordAdmission: "invitation" }, action);
    });
  }

  /**
   * Decides whether a verified (or invitation-bearing) identity may register right now. Called at
   * signup time and again when admission completes, so a policy, allowlist, or invitation change in
   * between is honored. `emailVerified` gates every path that relies on owning the address.
   */
  async decide(
    client: QueryHandle,
    input: { email: string; emailVerified: boolean; invitationId?: string | undefined },
  ): Promise<AdmissionDecision | undefined> {
    const mode = this.policy.registrationMode;
    if (mode === "disabled") return undefined;
    if (mode === "open") return { kind: "open" };
    const invitationId = await this.liveInvitation(client, input);
    if (invitationId !== undefined) return { kind: "invitation", invitationId };
    if (input.emailVerified && this.allowsDomainOf(input.email)) {
      return { kind: "domain", domain: emailDomain(input.email) };
    }
    return undefined;
  }

  async lockInvitation(client: TransactionHandle, invitationId: string): Promise<void> {
    await this.locks.withTxLock(client, invitationLockName(invitationId));
  }

  /** Whether this email may start self-registration: its exact domain is allowlisted. */
  allowsDomainOf(email: string): boolean {
    return (
      this.policy.registrationMode === "domain_self_registration" &&
      (this.policy.allowedDomains ?? []).includes(emailDomain(email))
    );
  }

  private async liveInvitation(
    client: QueryHandle,
    input: { email: string; emailVerified: boolean; invitationId?: string | undefined },
  ): Promise<string | undefined> {
    if (input.invitationId !== undefined) {
      return (await this.isInvited(input.email, input.invitationId, client))
        ? input.invitationId
        : undefined;
    }
    // Without the invitation link, only a verified address may claim an invitation sent to it.
    if (!input.emailVerified) return undefined;
    const result = await client.query<{ id: string }>(
      `select id from invitation
       where status = 'pending' and expires_at > now() and lower(email) = $1
       order by created_at desc limit 1`,
      [normalizeEmail(input.email)],
    );
    return result.rows[0]?.id;
  }

  async accountExists(email: string): Promise<boolean> {
    const existingUser = await this.pool.query(
      `select 1 from "user" where lower(email) = $1 limit 1`,
      [normalizeEmail(email)],
    );
    return existingUser.rowCount !== 0;
  }

  private async requireNewEmail(email: string): Promise<void> {
    if (await this.accountExists(email)) throw new RegistrationAdmissionError();
  }

  private async isInvited(
    email: string,
    invitationId: string,
    client: QueryHandle = this.pool,
  ): Promise<boolean> {
    if (this.policy.registrationMode === "disabled") return false;
    const result = await client.query(
      `select 1 from invitation
       where id = $1 and status = 'pending' and expires_at > now()
         and lower(email) = $2`,
      [invitationId, normalizeEmail(email)],
    );
    return result.rowCount === 1;
  }
}

export class RegistrationAdmissionError extends Error {
  constructor() {
    super("registration is not available");
    this.name = "RegistrationAdmissionError";
  }
}
