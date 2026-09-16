import { useMemo } from "react";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
import { useHubAccount } from "@/clisbot/hub/account-provider";
import { resolveMessageSender, type MessageSenderResolution } from "./actor-presentation";

export function useMessageSender(
  sender: SessionActor | undefined,
  confirmed = false,
): MessageSenderResolution {
  const { signedIn, origin, loading } = useHubAccount();
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
