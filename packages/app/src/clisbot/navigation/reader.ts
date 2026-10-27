import { useEffect, useMemo } from "react";
import { useHubAccounts } from "@/clisbot/hub/account-provider";
import { useReaderMemory } from "@/clisbot/hub/reader-memory";
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
  return useMemo(() => mergeReaderAccounts(live, Object.values(remembered)), [live, remembered]);
}

/** Mounted once: every Hub account's answer keeps the remembered readers in step. */
export function useRememberVerifiedReaders(): void {
  const accounts = useHubAccounts();
  useEffect(() => recordVerifiedReaders(accounts, useReaderMemory.getState()), [accounts]);
}
