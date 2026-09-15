import type { DatabaseRuntime } from "../db/runtime/index.js";
import type { Locks } from "../db/runtime/locks/index.js";
import type { VerificationMailer } from "../invitations/index.js";
import type { ProvisioningEntitlementResolver } from "../organizations/provisioning.js";
import { EmailVerification, type CreateVerifiedAccount } from "./email-verification.js";
import {
  GOOGLE_CALLBACK_PATH,
  GoogleAccountLinking,
  googleSocialProviders,
  SOCIAL_SIGN_IN_PATH,
  startGoogleSignIn,
  type GoogleAuthConfig,
} from "./google-sign-in.js";
import type { InstanceAuthPolicy } from "./instance-policy.js";
import type { InstanceSetup } from "../instance-setup/index.js";
import { RegistrationAdmission } from "./registration-admission.js";
import { RegistrationCompletion } from "./registration-completion.js";
import { EMAIL_REGISTRATION_PATHS } from "./registration-contract.js";
import { registrationDatabaseHooks } from "./registration-gate.js";
import { runInRegistrationScope } from "./registration-scope.js";

export interface RegistrationOptions {
  database: DatabaseRuntime;
  locks: Locks;
  policy: InstanceAuthPolicy;
  baseURL: string;
  provisioningEntitlements: ProvisioningEntitlementResolver;
  google: GoogleAuthConfig | undefined;
  mailer: VerificationMailer | undefined;
  /** First-run setup, which a Google sign-in from the setup screen claims. */
  instanceSetup: InstanceSetup;
  /** Hosts a user's profile image URL may point at. */
  profileImageHosts: readonly string[];
  onMembershipChanged?: (organizationId: string) => Promise<void>;
  onOrganizationAccessChanged?: (organizationId: string) => Promise<void>;
}

/** What the registration routes need from the Better Auth instance they sit in front of. */
export interface RegistrationAuth {
  handler(request: Request): Promise<Response>;
  createVerifiedAccount: CreateVerifiedAccount;
  rejectCookieMutation(request: Request): Response | undefined;
}

const EMAIL_REGISTRATION_ROUTES = new Set<string>(Object.values(EMAIL_REGISTRATION_PATHS));

/**
 * Clisbot registration: invitation-first admission, domain self-registration, email-first
 * password registration, and Google sign-in. Composed here so the upstream auth server only
 * passes Better Auth options through and forwards the routes this module owns.
 */
export function composeRegistration(options: RegistrationOptions) {
  const admission = new RegistrationAdmission(options.database, options.locks, options.policy);
  const completion = new RegistrationCompletion({
    pool: options.database,
    locks: options.locks,
    admission,
    provisioningEntitlements: options.provisioningEntitlements,
    ...(options.onMembershipChanged === undefined
      ? {}
      : { onMembershipChanged: options.onMembershipChanged }),
    ...(options.onOrganizationAccessChanged === undefined
      ? {}
      : { onOrganizationAccessChanged: options.onOrganizationAccessChanged }),
  });
  return {
    admission,
    googleSignIn: options.google !== undefined,
    emailRegistration: options.mailer !== undefined,
    betterAuthOptions: {
      socialProviders: googleSocialProviders(options.google),
      account: {
        accountLinking: {
          enabled: true,
          // Google proves the address; the gate revokes what an unverified password account held.
          requireLocalEmailVerified: false,
        },
      },
      databaseHooks: registrationDatabaseHooks({
        pool: options.database,
        admission,
        completion,
        linking: new GoogleAccountLinking(options.database),
        instanceSetup: options.instanceSetup,
        profileImageHosts: options.profileImageHosts,
      }),
    },
    routes: (auth: RegistrationAuth) => registrationRoutes(options, admission, auth),
  };
}

function registrationRoutes(
  options: RegistrationOptions,
  admission: RegistrationAdmission,
  auth: RegistrationAuth,
) {
  const emailRegistration = new EmailVerification({
    pool: options.database,
    locks: options.locks,
    baseURL: options.baseURL,
    mailer: options.mailer,
    admission,
    createAccount: auth.createVerifiedAccount,
  });
  return {
    /** Answers a route this module owns, or returns undefined for the caller to route. */
    handle(path: string, request: Request): Promise<Response> | undefined {
      if (path === GOOGLE_CALLBACK_PATH) {
        if (options.google === undefined) return undefined;
        // The scope carries the Google identity from the provider profile into the gate hooks.
        return runInRegistrationScope({}, () => auth.handler(request));
      }
      if (path !== SOCIAL_SIGN_IN_PATH && !EMAIL_REGISTRATION_ROUTES.has(path)) return undefined;
      const rejected = auth.rejectCookieMutation(request);
      if (rejected !== undefined) return Promise.resolve(rejected);
      return path === SOCIAL_SIGN_IN_PATH
        ? startGoogleSignIn(request, options.google !== undefined, auth.handler)
        : emailRegistration.handle(request);
    },
  };
}
