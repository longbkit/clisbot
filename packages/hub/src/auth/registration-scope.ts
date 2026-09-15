import { AsyncLocalStorage } from "node:async_hooks";

/** The Google identity the current OAuth callback resolved, captured before Better Auth acts. */
export interface GoogleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Per-request registration context shared between the Hub's auth entry points and the Better Auth
 * database hooks they trigger. Better Auth creates the user, account, and session rows; the hooks
 * need to know which admission path the request was already granted.
 */
export interface RegistrationScope {
  /**
   * How a password account created in this request was admitted: through its invitation link, or
   * through a registration link that proved the email before the account existed.
   */
  passwordAdmission?: "invitation" | "verifiedEmail";
  google?: GoogleIdentity;
}

const storage = new AsyncLocalStorage<RegistrationScope>();

export function runInRegistrationScope<T>(
  scope: RegistrationScope,
  operation: () => Promise<T>,
): Promise<T> {
  return storage.run(scope, operation);
}

export function currentRegistrationScope(): RegistrationScope | undefined {
  return storage.getStore();
}
