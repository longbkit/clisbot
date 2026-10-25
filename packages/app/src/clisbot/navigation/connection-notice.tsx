import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { issueCopy } from "@/clisbot/home/connection-issues-sheet";
import { ConnectionIssuesLine } from "@/clisbot/home/hosts-strip";
import { useHostsStrip } from "@/clisbot/home/hosts-strip-data";
import type { StripIssue } from "@/clisbot/home/hosts-strip-model";

/** What Home says about connections: one summary and the problems its sheet acts on. */
export interface ConnectionNoticeModel {
  summary: string;
  issues: readonly StripIssue[];
}

/**
 * The adapter seam: today it reads the Hosts strip's issue model. A per-source health summary can
 * replace this hook's body without touching the notice or Home.
 */
export function useHomeConnectionNotice(): ConnectionNoticeModel | null {
  const { issues } = useHostsStrip();
  if (!issues.length) return null;
  const first = issueCopy(issues[0]!).title;
  return {
    summary: issues.length === 1 ? first : `${first} · ${issues.length} connections`,
    issues,
  };
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
