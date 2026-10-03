/**
 * A Personal Hub's Local owner has no real address: the Hub stores a placeholder under the
 * reserved `.invalid` TLD (RFC 2606) because accounts require one (packages/hub/src/device-access/
 * personal-owner.ts). Such an address is internal attribution and never shown.
 */
export function visibleEmail(email: string | null | undefined): string | null {
  if (!email || email.endsWith(".invalid")) return null;
  return email;
}

/** "Name · email", or the parts that are worth showing. */
export function withEmail(label: string, email: string | null | undefined): string {
  const shown = visibleEmail(email);
  return shown ? `${label} · ${shown}` : label;
}
