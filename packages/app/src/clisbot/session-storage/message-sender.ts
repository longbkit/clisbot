import { useMemo } from "react";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
import { useHubAccount } from "@/clisbot/hub/account-provider";
import { resolveMessageSender, type MessageSenderResolution } from "./actor-presentation";

export function useMessageSender(sender: SessionActor | undefined): MessageSenderResolution {
  const { signedIn, origin, loading } = useHubAccount();
  const account = signedIn?.account ?? null;
  return useMemo(
    () => resolveMessageSender({ sender, account, accountOrigin: origin, accountLoading: loading }),
    [sender, account, origin, loading],
  );
}
