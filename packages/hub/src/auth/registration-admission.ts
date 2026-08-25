import type { DatabaseRuntime, TransactionHandle } from "../db/runtime/index.js";
import type { Locks } from "../db/runtime/locks/index.js";
import { z } from "zod";
import type { InstanceAuthPolicy } from "./instance-policy.js";
import { normalizeEmail } from "./instance-policy.js";
import { reportFailure } from "../failures/index.js";

const signupEmailBody = z.object({ email: z.string().email() }).passthrough();
const INVITATION_LOCK_PREFIX = "paseo:invitation:";

export function invitationLockName(invitationId: string): string {
  return `${INVITATION_LOCK_PREFIX}${invitationId}`;
}

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

  async withAdmission<T>(
    email: string,
    invitationId: string | undefined,
    action: () => Promise<T>,
  ): Promise<T> {
    if (this.policy.registrationMode === "open") return action();
    if (invitationId === undefined) throw new RegistrationAdmissionError();
    const lockKey = invitationLockName(invitationId);
    return this.locks.withLock(lockKey, async () => {
      if (!(await this.isAdmitted(email, invitationId))) {
        throw new RegistrationAdmissionError();
      }
      const existingUser = await this.pool.query(
        `select 1 from "user" where lower(email) = $1 limit 1`,
        [normalizeEmail(email)],
      );
      if (existingUser.rowCount !== 0) throw new RegistrationAdmissionError();
      return await action();
    });
  }

  async lockInvitation(client: TransactionHandle, invitationId: string): Promise<void> {
    await this.locks.withTxLock(client, invitationLockName(invitationId));
  }

  private async isAdmitted(email: string, invitationId: string): Promise<boolean> {
    if (this.policy.registrationMode === "disabled") return false;
    const result = await this.pool.query(
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
