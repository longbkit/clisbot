import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { RetainedPanel } from "@/components/retained-panel";
import type { WorkspaceRouteState } from "./workspace-route-state";

const ROOT_STYLE = { flex: 1 };

/** Keep an already opened workspace usable through reconnect; panes own their sync status. */
export function WorkspaceContentGate({
  kind,
  gate,
  children,
}: {
  kind: WorkspaceRouteState["kind"];
  gate: ReactNode;
  children: ReactNode;
}) {
  const [hasRenderedReady, setHasRenderedReady] = useState(false);
  useEffect(() => {
    if (kind === "ready") setHasRenderedReady(true);
    else if (kind !== "reconnecting") setHasRenderedReady(false);
  }, [kind]);
  const ready = kind === "ready";
  const retain = ready || (kind === "reconnecting" && hasRenderedReady);
  return (
    <View style={ROOT_STYLE}>
      <RetainedPanel active={retain} testID="retained-workspace-content">
        {retain ? children : null}
      </RetainedPanel>
      {retain ? null : gate}
    </View>
  );
}
