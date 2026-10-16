import { useRef, useSyncExternalStore } from "react";
import { usePanelStore } from "@/stores/panel-store";
import { useIsMobilePanelActive } from "@/mobile-panels/provider";
import { nativePresentation } from "./chat-list-presentation";

/** Keep the source page's geometry through the existing panel's actual visibility boundary. */
export function useIsChatListDeparting(): boolean {
  const revision = useSyncExternalStore(
    nativePresentation.subscribe,
    nativePresentation.getPendingRevision,
    nativePresentation.getPendingRevision,
  );
  const panel = usePanelStore((state) => state.mobilePanel);
  const listActive = useIsMobilePanelActive("agent-list");
  const sourceRevision = useRef<number | null>(null);
  const pending = revision !== null && panel.target === "agent-list" && revision === panel.revision;
  if (pending) sourceRevision.current = revision;
  // Completion clears the intent before the panel's UI worklet settles. Keep the outgoing footer
  // and selection until that same close actually hides the list; a newly opened overlay cannot inherit it.
  const sourceList = sourceRevision.current === panel.revision && panel.target === "agent-list";
  const closingList =
    sourceRevision.current !== null &&
    panel.revision === sourceRevision.current + 1 &&
    panel.target === "agent" &&
    listActive;
  const visible = pending || sourceList || closingList;
  if (!visible) sourceRevision.current = null;
  return visible;
}
