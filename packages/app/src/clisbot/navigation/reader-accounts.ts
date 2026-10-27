import type { HubAccountContextValue } from "@/clisbot/hub/account-provider";
import type { RememberedReader } from "@/clisbot/hub/reader-memory";

interface ReaderMemoryActions {
  remember(reader: RememberedReader): void;
  confirmSignedOut(origin: string): void;
}
import type { ReaderAccount } from "./ownership";

type SignedInAccount = Pick<HubAccountContextValue, "origin" | "connectionOrigin" | "signedIn">;

/**
 * The reader a signed-in Hub account verifies, or nothing while it is not signed in. A paired
 * Hub's `origin` is its stable `hub://<id>` scope; the HTTPS route it is reached by is an alias,
 * because the sessions it stamped name the Hub by that address.
 */
export function readerAccountOf(account: SignedInAccount): ReaderAccount | undefined {
  if (!account.signedIn || !account.origin) return undefined;
  return {
    origin: account.origin,
    aliases: account.connectionOrigin ? [account.connectionOrigin] : [],
    ...(account.origin.startsWith("hub://")
      ? { hubId: account.origin.slice("hub://".length) }
      : {}),
    id: account.signedIn.account.id,
    memberId: account.signedIn.membership.id,
  };
}

export function rememberedOf(reader: ReaderAccount): RememberedReader | undefined {
  if (!reader.origin || !reader.id) return undefined;
  return {
    origin: reader.origin,
    aliases: [...(reader.aliases ?? [])],
    id: reader.id,
    memberId: reader.memberId ?? null,
  };
}

/**
 * Live signed-in readers first; a Hub with no live reader falls back to the last one this device
 * verified for it. A live reader always replaces the remembered one, so a different account
 * signing in is never read as the previous one.
 */
export function mergeReaderAccounts(
  live: readonly ReaderAccount[],
  remembered: readonly RememberedReader[],
): ReaderAccount[] {
  const liveOrigins = new Set(live.map((reader) => reader.origin));
  return [...live, ...remembered.filter((reader) => !liveOrigins.has(reader.origin))];
}

/**
 * Keeps the memory in step with what each Hub account says now. A signed-in answer remembers the
 * reader (the memory ignores it after an explicit sign-out); an answer that nobody is signed in
 * confirms that sign-out. A Hub that could not answer changes nothing.
 */
export function recordVerifiedReaders(
  accounts: readonly (SignedInAccount & { state: unknown })[],
  memory: Pick<ReaderMemoryActions, "remember" | "confirmSignedOut">,
): void {
  for (const account of accounts) {
    const reader = readerAccountOf(account);
    const verified = reader && rememberedOf(reader);
    if (verified) memory.remember(verified);
    else if (account.state !== null && account.origin) memory.confirmSignedOut(account.origin);
  }
}
