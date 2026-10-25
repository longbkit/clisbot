import { useMemo } from "react";
import { useHubAccounts } from "@/clisbot/hub/account-provider";
import type { ReaderAccount } from "./ownership";

/** The signed-in Hub accounts on this device, as the ownership predicate reads them. */
export function useReaderAccounts(): readonly ReaderAccount[] {
  const accounts = useHubAccounts();
  return useMemo(
    () =>
      accounts.flatMap((account) =>
        account.signedIn
          ? [
              {
                origin: account.origin,
                id: account.signedIn.account.id,
                memberId: account.signedIn.membership.id,
              },
            ]
          : [],
      ),
    [accounts],
  );
}
