import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { issueCopy } from "@/clisbot/home/connection-issues-sheet";
import { ConnectionIssuesLine } from "@/clisbot/home/hosts-strip";
import { useHostsStrip } from "@/clisbot/home/hosts-strip-data";
import type { StripIssue } from "@/clisbot/home/hosts-strip-model";
import { useSourceHealthSummary } from "@/hooks/use-source-health";
import { connectionNoticeSummary } from "./connection-notice-model";

/** What Home says about connections: one summary and the problems its sheet acts on. */
export interface ConnectionNoticeModel {
  summary: string;
  issues: readonly StripIssue[];
}

/**
 * The adapter seam: the summary comes from per-source health (Offline O1), so a Hub outage is
 * named once with "x/y reachable" and one flaky Host never reads as an app-wide problem. The
 * actions (retry, sign in, details) still come from the Hosts strip's issue model.
 */
export function useHomeConnectionNotice(): ConnectionNoticeModel | null {
  const { issues } = useHostsStrip();
  const health = useSourceHealthSummary();
  const fromHealth = connectionNoticeSummary(health);
  if (!fromHealth && !issues.length) return null;
  const fallback = issues.length ? issueCopy(issues[0]!).title : "";
  return { summary: fromHealth ?? fallback, issues };
}

/**
 * Home's only word about connections (Atlas F1): nothing while every source is fine, one slim
 * line under the header when one is not. Hosts themselves live on the rail and in More.
 */
export function ConnectionNotice({ notice }: { notice: ConnectionNoticeModel | null }) {
  if (!notice) return null;
  return (
    <View style={styles.notice}>
      <ConnectionIssuesLine issues={[...notice.issues]} summary={notice.summary} />
    </View>
  );
}

export function HomeConnectionNotice() {
  return <ConnectionNotice notice={useHomeConnectionNotice()} />;
}

const styles = StyleSheet.create((theme) => ({
  notice: { paddingHorizontal: theme.spacing[2] },
}));
