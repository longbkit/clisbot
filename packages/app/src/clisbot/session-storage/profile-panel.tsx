import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { UserRound } from "lucide-react-native";
import invariant from "tiny-invariant";
import { definePanel } from "@/panels/panel-registry";
import { usePaneContext } from "@/panels/pane-context";
import { ActorAvatar, actorLabel } from "./actor";

function UserProfilePanel() {
  const { target } = usePaneContext();
  invariant(target.kind === "user_profile", "User profile target required");
  const { actor } = target;
  const fields = [
    ["ID", actor.id],
    ["Source", actor.kind],
    ["Hub", actor.hubOrigin],
    ["Organization", actor.organizationId],
    ["Connection", actor.connectionId],
    ["Verified Member", actor.memberId],
  ];
  return (
    <ScrollView contentContainerStyle={styles.container} testID="user-profile-panel">
      <View style={styles.heading}>
        <ActorAvatar actor={actor} />
        <Text style={styles.title}>{actorLabel(actor)}</Text>
      </View>
      {fields.map(([label, value]) =>
        value ? (
          <View key={label} style={styles.field}>
            <Text style={styles.label}>{label}</Text>
            <Text selectable style={styles.value}>
              {value}
            </Text>
          </View>
        ) : null,
      )}
      <Text style={styles.label}>Profile snapshot recorded with this interaction.</Text>
    </ScrollView>
  );
}

export const userProfilePanelRegistration = definePanel("user_profile", {
  component: UserProfilePanel,
  useDescriptor: (target) => ({
    label: actorLabel(target.actor),
    subtitle: "Profile",
    tooltip: target.actor.id,
    titleState: "ready",
    icon: UserRound,
    statusBucket: null,
  }),
});

const styles = StyleSheet.create((theme) => ({
  container: { padding: theme.spacing[4], gap: theme.spacing[4] },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.lg },
  field: { gap: theme.spacing[1] },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  value: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
}));
