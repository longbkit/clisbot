import { useMemo } from "react";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import { useHubAccount, useHubAccounts } from "@/clisbot/hub/account-provider";
import { resolveMessageSender, type MessageSenderResolution } from "./actor-presentation";

export function useMessageSender(
  sender: SessionActor | undefined,
  confirmed = false,
): MessageSenderResolution {
  const selected = useHubAccount();
  const accounts = useHubAccounts();
  const hub = sender?.hubOrigin
    ? accounts.find((account) => account.origin === sender.hubOrigin)
    : selected;
  const { signedIn, origin = null, loading = false } = hub ?? {};
  const account = signedIn?.account ?? null;
  // The reader's membership names them behind a channel snapshot, which records
  // the provider identity rather than the Hub `users.id`.
  const memberId = signedIn?.membership.id ?? null;
  return useMemo(
    () =>
      resolveMessageSender({
        sender,
        account,
        accountOrigin: origin,
        accountMemberId: memberId,
        accountLoading: loading,
        confirmed,
      }),
    [sender, account, origin, memberId, loading, confirmed],
  );
}
