import { createContext, useContext, type ReactNode } from "react";

import type { ActiveAccountState } from "./organization-contract.js";

/**
 * The account behind the dashboard shell. Panels are rendered through an `<Outlet />`
 * rather than by the shell itself, so they cannot receive it as a prop; the shell only
 * renders its outlet once the account has resolved to an active organization, which is
 * what lets `useActiveAccount` return a non-optional value.
 */
const ActiveAccount = createContext<ActiveAccountState | null>(null);

export function ActiveAccountProvider({
  account,
  children,
}: {
  account: ActiveAccountState;
  children: ReactNode;
}) {
  return <ActiveAccount.Provider value={account}>{children}</ActiveAccount.Provider>;
}

export function useActiveAccount(): ActiveAccountState {
  const account = useContext(ActiveAccount);
  if (account === null) throw new Error("useActiveAccount used outside the dashboard shell");
  return account;
}
