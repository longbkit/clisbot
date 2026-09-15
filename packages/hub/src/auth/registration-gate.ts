import { APIError } from "better-call";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import { normalizeEmail } from "./instance-policy.js";
import { GoogleAccountLinking, googleFlow, isGoogleCallback } from "./google-sign-in.js";
import type { InstanceSetup } from "../instance-setup/index.js";
import { profileUpdateHook } from "./profile-update.js";
import {
  RegistrationAdmissionError,
  type RegistrationAdmission,
} from "./registration-admission.js";
import type { RegistrationCompletion } from "./registration-completion.js";
import { REGISTRATION_ERROR_CODES } from "./registration-contract.js";
import {
  currentRegistrationScope,
  type GoogleIdentity,
  type RegistrationScope,
} from "./registration-scope.js";

interface GateOptions {
  pool: DatabaseRuntime;
  admission: RegistrationAdmission;
  completion: RegistrationCompletion;
  linking: GoogleAccountLinking;
  instanceSetup: InstanceSetup;
  profileImageHosts: readonly string[];
}

interface CreatedUser {
  email: string;
}

interface CreatedAccount {
  providerId: string;
  userId: string;
}

interface CreatedSession {
  userId: string;
}

/**
 * Better Auth database hooks that put registration admission in front of every row Better Auth
 * creates. Hooks, not route wrappers, because the Google callback creates the user, links the
 * account, and opens the session inside one Better Auth endpoint.
 */
export function registrationDatabaseHooks(options: GateOptions) {
  return {
    user: {
      create: {
        before: (user: CreatedUser, context: unknown) => beforeUserCreate(options, user, context),
      },
      update: { before: profileUpdateHook(options.profileImageHosts) },
    },
    account: {
      create: {
        before: async (account: CreatedAccount, context: unknown) => {
          if (account.providerId === "google" && isGoogleCallback(context)) {
            await options.linking.beforeLink(account.userId);
          }
        },
      },
    },
    session: {
      create: {
        before: (session: CreatedSession, context: unknown) =>
          beforeSessionCreate(options, session, context),
      },
    },
  };
}

async function beforeUserCreate(
  options: GateOptions,
  user: CreatedUser,
  context: unknown,
): Promise<{ data: { emailVerified: true } } | undefined> {
  const email = normalizeEmail(user.email);
  const scope = currentRegistrationScope();
  if (isGoogleCallback(context)) {
    const identity = requireGoogleIdentity(scope);
    if (!identity.emailVerified || identity.email !== email) {
      throw rejection(REGISTRATION_ERROR_CODES.googleEmailUnverified);
    }
    // An existing account makes Better Auth's insert fail; marking it would leave a stale marker.
    if (await options.admission.accountExists(email)) return undefined;
    const flow = await googleFlow();
    if (flow.claimInstance) {
      // First-run setup: the claim itself, under the setup locks, decides who becomes operator.
      if ((await options.instanceSetup.status()) !== "available") {
        throw rejection(REGISTRATION_ERROR_CODES.instanceUnavailable);
      }
    } else if (
      (await options.admission.decide(options.pool, {
        email,
        emailVerified: true,
        invitationId: flow.invitationId,
      })) === undefined
    ) {
      throw rejection(REGISTRATION_ERROR_CODES.closed);
    }
    // Written before the user row: a crash before provisioning commits leaves a pending account.
    await options.completion.markPending(email);
    return undefined;
  }
  if (scope?.passwordAdmission === "verifiedEmail") {
    // The registration link proved the address before this account existed.
    await options.completion.markPending(email);
    return { data: { emailVerified: true } };
  }
  await options.completion.clearPending(email);
  return undefined;
}

async function beforeSessionCreate(
  options: GateOptions,
  session: CreatedSession,
  context: unknown,
): Promise<{ data: { activeOrganizationId: string } } | undefined> {
  const google = isGoogleCallback(context);
  if (google) {
    const identity = requireGoogleIdentity(currentRegistrationScope());
    if (!(await options.linking.ownsIdentityEmail(identity, session.userId))) {
      throw rejection(REGISTRATION_ERROR_CODES.identityLinkedElsewhere);
    }
  }
  const account = await options.pool.query<{ email: string }>(
    `select email from "user" where id = $1`,
    [session.userId],
  );
  const user = account.rows[0];
  if (user === undefined || !(await options.completion.isPending(user.email))) return undefined;
  const flow = google ? await googleFlow() : undefined;
  if (flow?.claimInstance === true) return claimInstance(options, session.userId, user.email);
  try {
    const completed = await options.completion.complete(session.userId, flow?.invitationId);
    return completed.organizationId === null
      ? undefined
      : { data: { activeOrganizationId: completed.organizationId } };
  } catch (error) {
    if (error instanceof RegistrationAdmissionError) {
      throw rejection(REGISTRATION_ERROR_CODES.closed);
    }
    throw error;
  }
}

/**
 * COMPAT(clisbot-google-claim): the Google account just created from first-run setup claims the
 * pristine instance. A lost race removes the account again, so it neither lingers unadmitted nor
 * blocks a retry.
 */
async function claimInstance(
  options: GateOptions,
  userId: string,
  email: string,
): Promise<{ data: { activeOrganizationId: string } }> {
  const claimed = await options.instanceSetup.claimPendingAccount(userId);
  if (claimed !== undefined) return { data: { activeOrganizationId: claimed.organizationId } };
  await options.pool.query(`delete from "user" where id = $1`, [userId]);
  await options.completion.clearPending(email);
  throw rejection(REGISTRATION_ERROR_CODES.instanceUnavailable);
}

/** Every Google callback runs in a scope that captured the provider profile; a missing profile
 * means Hub cannot judge the identity, so the sign-in is refused under its own code. */
function requireGoogleIdentity(scope: RegistrationScope | undefined): GoogleIdentity {
  if (scope?.google === undefined) {
    throw rejection(REGISTRATION_ERROR_CODES.googleProfileUnavailable);
  }
  return scope.google;
}

function rejection(code: string): APIError {
  return new APIError("FORBIDDEN", { message: code, code });
}
