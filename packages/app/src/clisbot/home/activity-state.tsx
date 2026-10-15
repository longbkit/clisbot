import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useNavigateHomeTab } from "./mobile-navigation";
import { Button } from "@/components/ui/button";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useActivityViewport } from "./activity-viewport";
import { useActivityLayout } from "./use-activity-layout";
import { useLocalDay } from "./use-local-day";
import { activityBucket } from "./activity";
import { visibleActivityLayout } from "./activity-layout";

function useHomeActivityState() {
  const { agents, isInitialLoad, directoryHealth } = useAggregatedAgents();
  const { automatic, apply } = useActivityViewport();
  const day = useLocalDay();
  const { accepted, next, pending, accept } = useActivityLayout(agents, day, automatic);
  const [limit, setLimit] = useState(10);
  const showMore = useCallback(() => setLimit((current) => current + 10), []);
  const navigate = useNavigateHomeTab();
  const openInbox = useCallback(() => navigate("/sessions"), [navigate]);
  const update = useCallback(() => {
    const visible = visibleActivityLayout(next, limit);
    void apply(accept, new Set(visible.flatMap((section) => section.keys)));
  }, [apply, accept, next, limit]);
  const needs = agents.filter((agent) => activityBucket(agent) === "needs").length;
  return useMemo(
    () => ({
      agents,
      isInitialLoad,
      directoryHealth,
      accepted,
      pending,
      needs,
      limit,
      showMore,
      update,
      openInbox,
    }),
    [
      agents,
      isInitialLoad,
      directoryHealth,
      accepted,
      pending,
      needs,
      limit,
      showMore,
      update,
      openInbox,
    ],
  );
}
const Context = createContext<ReturnType<typeof useHomeActivityState> | null>(null);
export function HomeActivityProvider({ children }: { children: ReactNode }) {
  const value = useHomeActivityState();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useHomeActivity() {
  const value = useContext(Context);
  if (!value) throw new Error("Home activity requires its provider");
  return value;
}

/** A reserved rail outside the scroller: updates and urgent work remain reachable while reading. */
export function ActivityUpdates() {
  const { pending, needs, update, openInbox, directoryHealth } = useHomeActivity();
  const labels = {
    loading: "Loading activity…",
    refreshing: "Refreshing activity…",
    unavailable: "Refresh unavailable",
    ready: "Up to date",
  };
  let updateLabel = labels[directoryHealth.status];
  if (pending) updateLabel = `Show ${pending} ${pending === 1 ? "update" : "updates"}`;
  return (
    <View style={styles.rail} testID="home-activity-updates">
      <Button
        size="sm"
        variant="ghost"
        onPress={update}
        disabled={!pending}
        testID="home-activity-apply"
      >
        {updateLabel}
      </Button>
      <Button size="sm" variant="ghost" onPress={openInbox} testID="home-activity-needs">
        {`Needs you ${needs}`}
      </Button>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  rail: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    width: "100%",
    maxWidth: theme.contentMaxWidth,
    alignSelf: "center",
  },
}));
