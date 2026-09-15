import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isAPIError } from "better-auth/api";
import { z } from "zod";
import type { DatabaseRuntime, QueryRow } from "../db/runtime/index.js";
import type { Locks } from "../db/runtime/locks/index.js";
import { reportFailure } from "../failures/index.js";
import { INTERNAL_CLIENT_ADDRESS_HEADER } from "../http/client-address.js";
import type { VerificationMailer } from "../invitations/index.js";
import { normalizeEmail, PASSWORD_MIN_LENGTH } from "./instance-policy.js";
import type { RegistrationAdmission } from "./registration-admission.js";
import {
  EMAIL_REGISTRATION_PATHS,
  EMAIL_REGISTRATION_QUERY_PARAMETER,
  REGISTRATION_ERROR_CODES,
  type RegistrationLinkStatus,
} from "./registration-contract.js";

const LINK_LIFETIME_SECONDS = 30 * 60;
const LINK_COOLDOWN_SECONDS = 60;
const LINKS_PER_HOUR = 5;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const ATTEMPTS_PER_WINDOW = 20;

const startBody = z.object({ email: z.string().trim().email() }).strict();
const tokenBody = z.object({ token: z.string().min(32).max(200) }).strict();
const completeBody = tokenBody
  .extend({
    name: z.string().trim().min(1).max(100),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(128),
  })
  .strict();

/** Creates the password account inside a verified-email registration scope and signs it in. */
export type CreateVerifiedAccount = (
  input: { name: string; email: string; password: string },
  headers: Headers,
) => Promise<Headers>;

interface LinkRow extends QueryRow {
  id: string;
  email: string;
  expires_at: Date;
  expired: boolean;
  consumed_at: Date | null;
}

interface EmailVerificationOptions {
  pool: DatabaseRuntime;
  locks: Locks;
  baseURL: string;
  mailer: VerificationMailer | undefined;
  admission: RegistrationAdmission;
  createAccount: CreateVerifiedAccount;
}

/**
 * Email-first self-registration. The Hub mails a link before any account exists; the person who
 * opens it chooses the name and password, and only then is the account created and admitted. A
 * stranger who types someone else's address gets nothing: no account, no password, and no claim
 * on the address. Links are random, stored as hashes, short-lived, and used once.
 */
export class EmailVerification {
  private readonly attempts = new AttemptLimiter(ATTEMPTS_PER_WINDOW, ATTEMPT_WINDOW_MS);

  constructor(private readonly options: EmailVerificationOptions) {}

  get available(): boolean {
    return this.options.mailer !== undefined;
  }

  async handle(request: Request): Promise<Response> {
    if (request.method !== "POST") return Response.json({ error: "not_found" }, { status: 404 });
    const client = request.headers.get(INTERNAL_CLIENT_ADDRESS_HEADER) ?? "unknown";
    if (!this.attempts.allow(client)) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }
    const body: unknown = await request.json().catch(() => undefined);
    const path = new URL(request.url).pathname;
    if (path === EMAIL_REGISTRATION_PATHS.start) return this.start(body);
    if (path === EMAIL_REGISTRATION_PATHS.inspect) return this.inspect(body);
    return this.complete(body, request.headers);
  }

  private async start(body: unknown): Promise<Response> {
    const input = startBody.safeParse(body);
    if (!input.success) return Response.json({ error: "invalid_request" }, { status: 400 });
    const email = normalizeEmail(input.data.email);
    if (!this.options.admission.allowsDomainOf(email)) {
      return Response.json({ error: REGISTRATION_ERROR_CODES.closed }, { status: 403 });
    }
    const mailer = this.options.mailer;
    if (mailer === undefined) {
      return Response.json({ error: "verification_unavailable" }, { status: 503 });
    }
    // The answer is the same whether or not an account already uses this address.
    if (await this.options.admission.accountExists(email)) return accepted();
    const delivery = await this.sendLink(mailer, email);
    if (delivery === "rate_limited") {
      return Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "retry-after": String(LINK_COOLDOWN_SECONDS) } },
      );
    }
    return delivery === "sent"
      ? accepted()
      : Response.json({ error: "delivery_failed" }, { status: 502 });
  }

  private async sendLink(
    mailer: VerificationMailer,
    email: string,
  ): Promise<"sent" | "failed" | "rate_limited"> {
    const token = randomBytes(32).toString("base64url");
    const link = await this.options.pool.transaction(async (client) => {
      await this.options.locks.withTxLock(client, `paseo:email-verification:${email}`);
      const recent = await client.query<{ hourly: number; cooling: boolean }>(
        `select count(*)::integer as hourly,
                coalesce(bool_or(created_at > now() - make_interval(secs => $2)), false) as cooling
         from email_verification_tokens
         where email = $1 and created_at > now() - interval '1 hour'`,
        [email, LINK_COOLDOWN_SECONDS],
      );
      const usage = recent.rows[0];
      if (usage === undefined || usage.cooling || usage.hourly >= LINKS_PER_HOUR) return undefined;
      const inserted = await client.query<{ id: string; expires_at: Date }>(
        `insert into email_verification_tokens (id, email, token_hash, expires_at)
         values ($1, $2, $3, now() + make_interval(secs => $4))
         returning id, expires_at`,
        [randomUUID(), email, tokenHash(token), LINK_LIFETIME_SECONDS],
      );
      return inserted.rows[0];
    });
    if (link === undefined) return "rate_limited";
    const url = new URL("/", this.options.baseURL);
    url.searchParams.set(EMAIL_REGISTRATION_QUERY_PARAMETER, token);
    try {
      await mailer.send({ id: link.id, email, link: url.toString(), expiresAt: link.expires_at });
      return "sent";
    } catch (error) {
      // The error carries only the provider status; the link token never reaches a log.
      reportFailure(error, { operation: "auth.email_registration.deliver", component: "auth" });
      return "failed";
    }
  }

  private async inspect(body: unknown): Promise<Response> {
    const input = tokenBody.safeParse(body);
    if (!input.success) return Response.json({ error: "invalid_request" }, { status: 400 });
    const link = await this.link(input.data.token);
    const status = linkStatus(link);
    if (link === undefined || status !== "valid") return linkResponse(status);
    return Response.json({ status, email: link.email, expiresAt: link.expires_at.toISOString() });
  }

  private async complete(body: unknown, headers: Headers): Promise<Response> {
    const input = completeBody.safeParse(body);
    if (!input.success) return Response.json({ error: "invalid_request" }, { status: 400 });
    const link = await this.link(input.data.token);
    if (link === undefined) return linkResponse("invalid");
    return this.options.locks.withLock(`paseo:registration-email:${link.email}`, async () => {
      // Recheck under the lock: a concurrent submit of the same link may have used it.
      const current = await this.link(input.data.token);
      const status = linkStatus(current);
      if (current === undefined || status !== "valid") return linkResponse(status);
      return this.register(
        current,
        { name: input.data.name, password: input.data.password },
        headers,
      );
    });
  }

  private async register(
    link: LinkRow,
    account: { name: string; password: string },
    requestHeaders: Headers,
  ): Promise<Response> {
    const decision = await this.options.admission.decide(this.options.pool, {
      email: link.email,
      emailVerified: true,
    });
    if (decision === undefined) return linkResponse("registration_closed");
    if (await this.options.admission.accountExists(link.email)) {
      await this.consume(link.id);
      return linkResponse("already_registered");
    }
    try {
      const headers = await this.options.createAccount(
        { ...account, email: link.email },
        requestHeaders,
      );
      await this.consume(link.id);
      return Response.json({ status: "registered" }, { headers });
    } catch (error) {
      // An account created but refused admission keeps its proven email and chosen password; its
      // next sign-in retries admission under the policy in force then.
      if (!(await this.options.admission.accountExists(link.email))) throw error;
      await this.consume(link.id);
      if (isAPIError(error) && error.body?.code === REGISTRATION_ERROR_CODES.closed) {
        return linkResponse("registration_closed");
      }
      throw error;
    }
  }

  private async link(token: string): Promise<LinkRow | undefined> {
    const result = await this.options.pool.query<LinkRow>(
      `select id, email, expires_at, expires_at <= now() as expired, consumed_at
       from email_verification_tokens where token_hash = $1`,
      [tokenHash(token)],
    );
    return result.rows[0];
  }

  private async consume(id: string): Promise<void> {
    await this.options.pool.query(
      `update email_verification_tokens set consumed_at = coalesce(consumed_at, now())
       where id = $1`,
      [id],
    );
  }
}

function linkStatus(link: LinkRow | undefined): RegistrationLinkStatus {
  if (link === undefined) return "invalid";
  if (link.consumed_at !== null) return "used";
  return link.expired ? "expired" : "valid";
}

const LINK_STATUS_CODES: Record<RegistrationLinkStatus, number> = {
  valid: 200,
  registered: 200,
  invalid: 404,
  expired: 410,
  used: 409,
  already_registered: 409,
  registration_closed: 403,
};

function linkResponse(status: RegistrationLinkStatus): Response {
  return Response.json({ status }, { status: LINK_STATUS_CODES[status] });
}

function accepted(): Response {
  return Response.json({ status: "accepted" }, { status: 202 });
}

function tokenHash(token: string): string {
  return createHash("sha256")
    .update("paseo-email-verification\0")
    .update(token)
    .digest("base64url");
}

/** A small per-client fixed window. Link tokens carry 256 bits, so this bounds abuse (mail
 * flooding, database load) rather than guessing. */
class AttemptLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const window = this.windows.get(key);
    if (window === undefined || now - window.startedAt >= this.windowMs) {
      if (this.windows.size > 10_000) this.windows.clear();
      this.windows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= this.limit;
  }
}
