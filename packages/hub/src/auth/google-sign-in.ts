import { getOAuthState } from "better-auth/api";
import { z } from "zod";
import type { DatabaseRuntime, QueryRow } from "../db/runtime/index.js";
import { normalizeEmail } from "./instance-policy.js";
import { currentRegistrationScope, type GoogleIdentity } from "./registration-scope.js";

export const SOCIAL_SIGN_IN_PATH = "/api/auth/sign-in/social";
export const GOOGLE_CALLBACK_PATH = "/api/auth/callback/google";

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
}

/** Google is enabled only when both client credentials are present; one without the other is a
 * configuration error rather than a silently disabled provider. */
export function readGoogleAuthConfig(
  environment: Record<string, string | undefined>,
): GoogleAuthConfig | undefined {
  const clientId = environment["PASEO_GOOGLE_AUTH_CLIENT_ID"]?.trim() ?? "";
  const clientSecret = environment["PASEO_GOOGLE_AUTH_CLIENT_SECRET"]?.trim() ?? "";
  if (clientId.length === 0 && clientSecret.length === 0) return undefined;
  if (clientId.length === 0 || clientSecret.length === 0) {
    throw new Error(
      "PASEO_GOOGLE_AUTH_CLIENT_ID and PASEO_GOOGLE_AUTH_CLIENT_SECRET must be supplied together",
    );
  }
  return { clientId, clientSecret };
}

const googleProfile = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean().optional(),
});

/** Better Auth `socialProviders` entry. The profile is captured into the registration scope so
 * the admission hooks judge the identity Google actually returned. */
export function googleSocialProviders(config: GoogleAuthConfig | undefined) {
  if (config === undefined) return {};
  return {
    google: {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      prompt: "select_account" as const,
      mapProfileToUser(profile: unknown) {
        const parsed = googleProfile.safeParse(profile);
        const scope = currentRegistrationScope();
        if (parsed.success && scope !== undefined) {
          scope.google = {
            subject: parsed.data.sub,
            email: normalizeEmail(parsed.data.email),
            emailVerified: parsed.data.email_verified === true,
          };
        }
        return {};
      },
    },
  };
}

interface HookContext {
  path?: string;
  params?: Record<string, unknown>;
}

export function isGoogleCallback(context: unknown): boolean {
  const hook = context as HookContext | null | undefined;
  return hook?.path === "/callback/:id" && hook.params?.["id"] === "google";
}

export interface GoogleFlow {
  /** Only a hint: admission still requires the verified email to match a live invitation. */
  invitationId: string | undefined;
  /** Started from first-run setup: the account should claim the pristine instance. */
  claimInstance: boolean;
}

/** What the browser carried into the Google flow, restored from Better Auth's server-side OAuth
 * state rather than from the callback URL. */
export async function googleFlow(): Promise<GoogleFlow> {
  const state = (await getOAuthState()) as Record<string, unknown> | null;
  const invitation = state?.["invitation"];
  return {
    invitationId: typeof invitation === "string" && invitation.length > 0 ? invitation : undefined,
    claimInstance: state?.["intent"] === "claimInstance",
  };
}

const socialSignInBody = z
  .object({
    provider: z.literal("google"),
    callbackURL: z.string().max(2000).optional(),
    invitation: z.string().min(1).max(200).optional(),
    intent: z.literal("claimInstance").optional(),
  })
  .strict();

/**
 * The only way into Better Auth's social sign-in. Hub fixes the provider, keeps every redirect on
 * its own origin, and passes the invitation through the signed OAuth state instead of the URL.
 */
export async function startGoogleSignIn(
  request: Request,
  enabled: boolean,
  handler: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (!enabled || request.method !== "POST") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const parsed = socialSignInBody.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const callbackURL = sameOriginPath(parsed.data.callbackURL);
  return handler(
    new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        provider: "google",
        callbackURL,
        errorCallbackURL: callbackURL,
        disableRedirect: true,
        additionalData: {
          ...(parsed.data.invitation === undefined ? {} : { invitation: parsed.data.invitation }),
          ...(parsed.data.intent === undefined ? {} : { intent: parsed.data.intent }),
        },
      }),
    }),
  );
}

function sameOriginPath(value: string | undefined): string {
  if (value === undefined || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value.includes("\\") ? "/" : value;
}

interface LinkTargetRow extends QueryRow {
  email_verified: boolean;
  has_password: boolean;
  is_instance_operator: boolean;
}

/**
 * Account-linking safety for Google. Linking a verified Google identity to an existing password
 * account is automatic, with two exceptions:
 *
 * - An instance operator is never linked automatically. Instance setup marks the operator's email
 *   verified on the operator's word, without proof, so a mistyped address would otherwise hand the
 *   instance to whoever owns it at Google. An operator account that already has Google linked
 *   still signs in with Google; this only refuses the first link.
 * - An unverified password account may have been registered by someone who never owned the
 *   address, so everything that account could already use is revoked before linking.
 */
export class GoogleAccountLinking {
  constructor(private readonly pool: DatabaseRuntime) {}

  /** Runs before Better Auth inserts the Google account row for an existing user. Throwing makes
   * Better Auth abandon the link and redirect with `?error=unable_to_link_account`. */
  async beforeLink(userId: string): Promise<void> {
    const target = await this.pool.query<LinkTargetRow>(
      `select u.email_verified, u.is_instance_operator,
              exists(select 1 from account a
                     where a.user_id = u.id and a.provider_id = 'credential') as has_password
       from "user" u where u.id = $1`,
      [userId],
    );
    const row = target.rows[0];
    if (row?.is_instance_operator === true) throw new OperatorLinkRefusedError();
    if (row === undefined || row.email_verified || !row.has_password) return;
    await this.pool.transaction(async (client) => {
      await client.query(`delete from oauth_access_token where user_id = $1`, [userId]);
      await client.query(`delete from oauth_refresh_token where user_id = $1`, [userId]);
      await client.query(`delete from session where user_id = $1`, [userId]);
      await client.query(
        `update organization_cli_credentials set revoked_at = coalesce(revoked_at, now())
         where created_by_user_id = $1`,
        [userId],
      );
      // The password was chosen by whoever registered the unverified address; it no longer signs in.
      await client.query(`delete from account where user_id = $1 and provider_id = 'credential'`, [
        userId,
      ]);
    });
  }

  /**
   * A Google identity already linked to one Hub user must not sign into that user while its
   * verified email belongs to a different Hub user: that is two accounts, and merging them needs
   * an operator.
   */
  async ownsIdentityEmail(identity: GoogleIdentity, userId: string): Promise<boolean> {
    const owner = await this.pool.query<{ id: string }>(
      `select id from "user" where lower(email) = $1 limit 1`,
      [identity.email],
    );
    const ownerId = owner.rows[0]?.id;
    return ownerId === undefined || ownerId === userId;
  }
}

export class OperatorLinkRefusedError extends Error {
  constructor() {
    super("Google is not linked to an instance operator automatically");
    this.name = "OperatorLinkRefusedError";
  }
}
