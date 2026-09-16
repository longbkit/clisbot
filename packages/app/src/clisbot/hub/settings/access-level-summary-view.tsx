import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import type { AccessResourceKind, SubjectKind } from "./access-catalog";
import { accessChanges, effectLines, summarizeAccess } from "./access-level-summary";

/**
 * What the chosen access does, shown under the level picker before anyone saves:
 * what it allows, what it leaves out, what saving changes when editing, and the
 * consequences worth reading twice.
 */
export function AccessLevelSummary({
  privileges,
  savedPrivileges,
  resourceKind,
  subjectKind,
}: {
  privileges: readonly string[];
  /** The privileges stored on the assignment being edited, if any. */
  savedPrivileges: readonly string[] | undefined;
  resourceKind: AccessResourceKind;
  subjectKind: SubjectKind | undefined;
}) {
  if (privileges.length === 0) return null;
  const summary = summarizeAccess({ privileges, resourceKind, subjectKind });
  const changes =
    savedPrivileges === undefined
      ? null
      : accessChanges({ before: savedPrivileges, after: privileges, resourceKind });
  const details = [
    effectLines(null, summary.allows),
    effectLines("Not included", summary.withholds),
    effectLines("Saving adds", changes?.added ?? []),
    effectLines("Saving removes", changes?.removed ?? []),
  ].filter((section): section is string => section !== null);
  return (
    <View style={styles.container} testID="access-level-summary">
      <Alert title="This access allows" description={details.join("\n\n")} />
      {summary.cautions.length > 0 ? (
        <Alert
          variant="warning"
          title="Before you grant"
          description={effectLines(null, summary.cautions) ?? undefined}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { gap: theme.spacing[3] },
}));
