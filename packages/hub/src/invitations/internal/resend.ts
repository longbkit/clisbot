import { z } from "zod";
import type { InvitationEmail, InvitationMailer } from "../index.js";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const DELIVERY_TIMEOUT_MS = 10_000;

export interface ResendConfig {
  apiKey: string;
  from: string;
}

type SendRequest = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const apiKeySchema = z
  .string()
  .trim()
  .min(1, "RESEND_API_KEY must not be blank")
  .refine((value) => value.startsWith("re_"), 'RESEND_API_KEY must start with "re_"');

const senderSchema = z.string().trim().min(1, "RESEND_FROM must not be blank");

export function readResendConfig(
  environment: Record<string, string | undefined>,
): ResendConfig | undefined {
  const rawKey = environment["RESEND_API_KEY"];
  if (rawKey === undefined || rawKey.trim().length === 0) return undefined;
  const key = apiKeySchema.safeParse(rawKey);
  if (!key.success) {
    throw new Error(`RESEND_API_KEY is invalid: ${key.error.issues[0]?.message}`);
  }
  const rawFrom = environment["RESEND_FROM"];
  if (rawFrom === undefined || rawFrom.trim().length === 0) {
    throw new Error("RESEND_FROM is required when RESEND_API_KEY is set");
  }
  const from = senderSchema.parse(rawFrom);
  return { apiKey: key.data, from };
}

export function createResendInvitationMailer(
  config: ResendConfig,
  sendRequest: SendRequest = fetch,
): InvitationMailer {
  return {
    async send(invitation) {
      const response = await sendRequest(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `paseo-invitation-${invitation.id}`,
        },
        body: JSON.stringify(message(config.from, invitation)),
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Resend rejected invitation email with status ${response.status}`);
      }
    },
  };
}

function message(from: string, invitation: InvitationEmail) {
  const role = invitation.role === "admin" ? "an admin" : "a member";
  const introduction = `${invitation.inviterName} invited you to join ${invitation.organizationName} as ${role}.`;
  const expiry = `This invitation expires at ${invitation.expiresAt.toISOString()}.`;
  const organizationName = escapeHtml(invitation.organizationName);
  const invitationLink = escapeHtml(invitation.link);
  return {
    from,
    to: [invitation.email],
    subject: `Join ${invitation.organizationName} on Paseo`,
    text: `${introduction}\n\nAccept the invitation: ${invitation.link}\n\n${expiry}`,
    html: `<p>${escapeHtml(introduction)}</p><p><a href="${invitationLink}">Join ${organizationName}</a></p><p>${escapeHtml(expiry)}</p>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
