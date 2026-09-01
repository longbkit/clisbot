import { createResendInvitationMailer, readResendConfig } from "./internal/resend.js";

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
