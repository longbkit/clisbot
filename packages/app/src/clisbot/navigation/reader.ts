import { useEffect, useMemo } from "react";
import { useHubAccounts } from "@/clisbot/hub/account-provider";
import { isSignedOutReader, useReaderMemory } from "@/clisbot/hub/reader-memory";
import type { ReaderAccount } from "./ownership";
import { mergeReaderAccounts, readerAccountOf, recordVerifiedReaders } from "./reader-accounts";

function useLiveReaders(): readonly ReaderAccount[] {
  const accounts = useHubAccounts();
  return useMemo(() => accounts.flatMap((account) => readerAccountOf(account) ?? []), [accounts]);
}

/**
 * The reader on each Hub this device knows: the live signed-in account, else the last one it
 * verified for that Hub, so an offline or signed-out moment does not reclassify anyone's work.
 */
export function useReaderAccounts(): readonly ReaderAccount[] {
  const live = useLiveReaders();
  const remembered = useReaderMemory((state) => state.readers);
  const signedOut = useReaderMemory((state) => state.signedOut);
  return useMemo(
    () =>
      mergeReaderAccounts(
        // An account that signed out explicitly is not the reader, whatever the query still says.
        live.filter((reader) => !isSignedOutReader(signedOut, reader)),
        Object.values(remembered),
      ),
    [live, remembered, signedOut],
  );
}

/** Mounted once: every Hub account's answer keeps the remembered readers in step. */
export function useRememberVerifiedReaders(): void {
  const accounts = useHubAccounts();
  // A change to the sign-out marks runs it again: a completed sign-in lets the account in.
  const signedOut = useReaderMemory((state) => state.signedOut);
  useEffect(
    () => recordVerifiedReaders(accounts, useReaderMemory.getState()),
    [accounts, signedOut],
  );
}
