const EMAIL_SEPARATORS = /[\s,;]+/;
// Same shape Hub accepts; Hub still validates each address.
const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export interface InvitationEmailList {
  emails: string[];
  invalid: string[];
}

/**
 * Reads a pasted list of invitees. Accepts commas, semicolons, spaces, and new lines, and the
 * `Name <address>` form mail clients copy. Addresses are lower-cased and de-duplicated in order.
 */
export function parseInvitationEmails(text: string): InvitationEmailList {
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const token of text.replace(/<([^>]*)>/g, " $1 ").split(EMAIL_SEPARATORS)) {
    const candidate = token.trim().toLowerCase();
    if (candidate.length === 0) continue;
    if (!EMAIL_PATTERN.test(candidate)) {
      if (candidate.includes("@") && !invalid.includes(candidate)) invalid.push(candidate);
      continue;
    }
    if (!emails.includes(candidate)) emails.push(candidate);
  }
  return { emails, invalid };
}

export interface InvitationFailure {
  email: string;
  message: string;
}

/** Sends one invitation per address, in order, and reports the addresses Hub refused. */
export async function sendInvitations(
  emails: string[],
  invite: (email: string) => Promise<void>,
): Promise<InvitationFailure[]> {
  const failures: InvitationFailure[] = [];
  for (const email of emails) {
    try {
      await invite(email);
    } catch (error) {
      failures.push({ email, message: invitationFailureMessage(error) });
    }
  }
  return failures;
}

function invitationFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  // Hub answers 409 both for an existing Member and for a full seat plan.
  if (message.includes("(409)")) return "already a Member, or no free seat";
  if (message.includes("(403)")) return "you can't invite Members";
  return message.length > 0 ? message : "Hub request failed";
}
