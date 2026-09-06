import * as Linking from "expo-linking";
import { useCallback, useState } from "react";

type ContinuationState =
  | { status: "idle" }
  | { status: "opening" | "ready" | "failed"; url: string };

/** Retains an existing provider attempt when opening its browser page fails. */
export function useHubConnectionContinuation() {
  const [state, setState] = useState<ContinuationState>({ status: "idle" });
  const open = useCallback(async (url: string) => {
    setState({ status: "opening", url });
    let status: "ready" | "failed" = "ready";
    try {
      await Linking.openURL(url);
    } catch {
      status = "failed";
    }
    setState((current) =>
      current.status !== "idle" && current.url === url ? { status, url } : current,
    );
  }, []);
  const url = state.status === "idle" ? null : state.url;
  const retry = useCallback(() => {
    if (url !== null) void open(url);
  }, [open, url]);
  const dismiss = useCallback(() => setState({ status: "idle" }), []);
  return {
    url,
    pending: state.status === "opening",
    error:
      state.status === "failed"
        ? "The provider page could not open. Use Continue setup to try again."
        : null,
    open,
    retry,
    dismiss,
  };
}
