import { useCallback, useEffect, useState } from "react";
import { openExternalUrl } from "@/utils/open-external-url";
import { startAccountConnect } from "./data";
import { toErrorMessage } from "@/utils/error-messages";

/** Composio's sign-in links stop working after about ten minutes. */
const LINK_LIFETIME_MS = 10 * 60_000;

/**
 * Starts a Composio sign-in for one app and opens it. The link stays offered afterwards: a
 * browser blocks a tab opened after a network call (the click is spent by then), and a person
 * who closed the tab can open it again without a new link.
 */
export function useConnectAccount(serverId: string, slug: string) {
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    if (link === null) return;
    const timer = setTimeout(() => setLink(null), LINK_LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [link]);
  const run = useCallback(
    async (alias?: string) => {
      setBusy(true);
      setError(null);
      setLink(null);
      try {
        const url = await startAccountConnect(serverId, slug, alias);
        setLink(url);
        await openExternalUrl(url);
      } catch (cause) {
        setError(toErrorMessage(cause));
      } finally {
        setBusy(false);
      }
    },
    [serverId, slug],
  );
  return {
    busy,
    naming,
    error,
    link,
    reopen: useCallback(() => {
      if (link) void openExternalUrl(link);
    }, [link]),
    start: useCallback(() => void run(), [run]),
    askName: useCallback(() => setNaming(true), []),
    closeName: useCallback(() => setNaming(false), []),
    startNamed: useCallback(
      (alias: string) => {
        setNaming(false);
        void run(alias);
      },
      [run],
    ),
  };
}

export type ConnectAccount = ReturnType<typeof useConnectAccount>;
