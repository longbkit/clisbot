import {
  createResendInvitationMailer,
  createResendVerificationMailer,
  readResendConfig,
} from "./internal/resend.js";

export interface InvitationEmail {
  id: string;
  email: string;
  inviterName: string;
  organizationName: string;
  role: "admin" | "member";
  link: string;
  expiresAt: Date;
}

export interface InvitationMailer {
  send(invitation: InvitationEmail): Promise<void>;
}

/**
 * Invitation email is optional. An absent key leaves the existing copy-link workflow intact;
 * a present key must be accompanied by an explicit, verified sender.
 */
export function composeInvitationMailer(
  environment: Record<string, string | undefined> = process.env,
): InvitationMailer | undefined {
  const config = readResendConfig(environment);
  return config === undefined ? undefined : createResendInvitationMailer(config);
}

export interface VerificationEmail {
  /** Stable per link, so a retried delivery of the same link is idempotent at the provider. */
  id: string;
  email: string;
  link: string;
  expiresAt: Date;
}

export interface VerificationMailer {
  send(verification: VerificationEmail): Promise<void>;
}

/**
 * Registration verification mail shares the invitation delivery configuration. Absent
 * configuration means password self-registration cannot be offered: the caller reports that
 * instead of admitting anyone unverified.
 */
export function composeVerificationMailer(
  environment: Record<string, string | undefined> = process.env,
): VerificationMailer | undefined {
  const config = readResendConfig(environment);
  return config === undefined ? undefined : createResendVerificationMailer(config);
}
