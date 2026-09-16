import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { UserRound } from "lucide-react-native";
import invariant from "tiny-invariant";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
import { definePanel } from "@/panels/panel-registry";
import { usePaneContext } from "@/panels/pane-context";
import {
  useChannelIdentityDirectory,
  type LinkedChannelIdentity,
} from "@/clisbot/hub/channel-identity-directory";
import { ActorAvatar, actorLabel } from "./actor";
import { usePersonProfile, type PersonProfile } from "./person";

function Field({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

/** Who this is, as the Hub knows them now. */
function PersonSection({ actor, person }: { actor: SessionActor; person: PersonProfile }) {
  return (
    <View style={styles.section}>
      <Field label="Hub user" value={person.member?.userId} />
      <Field label="Email" value={person.member?.email} />
      <Field label="Verified Member" value={actor.memberId} />
      <Field label="Organization" value={actor.organizationId} />
      <Field label="Hub" value={actor.hubOrigin} />
    </View>
  );
}

/**
 * Every Channel the person has linked, not only the one this session saw. Hub
 * scopes the list, so it is empty for anyone but yourself unless you administer
 * the organization.
 */
function LinkedIdentities({ identities }: { identities: LinkedChannelIdentity[] }) {
  if (identities.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Channel identities</Text>
      {identities.map((identity) => (
        <View key={identity.id} style={styles.field}>
          <Text style={styles.value}>{identity.subject}</Text>
          <Text style={styles.label}>{identity.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** The snapshot this interaction was recorded with — provenance, frozen. */
function RecordedAs({ actor }: { actor: SessionActor }) {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Recorded as</Text>
      <Field label="Identity" value={actor.id} />
      <Field label="Source" value={actor.kind} />
      <Field label="Connection" value={actor.connectionId} />
      <Text style={styles.label}>Profile snapshot recorded with this interaction.</Text>
    </View>
  );
}

function UserProfilePanel() {
  const { target } = usePaneContext();
  invariant(target.kind === "user_profile", "User profile target required");
  const { actor } = target;
  const person = usePersonProfile(actor);
  // An Automation, the daemon itself, or an unlinked sender has no Member to
  // look up, so that profile costs no Hub read at all.
  const directory = useChannelIdentityDirectory({ enabled: actor.memberId !== undefined });
  return (
    <ScrollView contentContainerStyle={styles.container} testID="user-profile-panel">
      <View style={styles.headingRow}>
        <ActorAvatar actor={actor} />
        <Text style={styles.title}>{actorLabel(person.actor)}</Text>
      </View>
      <PersonSection actor={actor} person={person} />
      <LinkedIdentities identities={directory.identitiesOf(actor.memberId)} />
      <RecordedAs actor={actor} />
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
  container: { padding: theme.spacing[4], gap: theme.spacing[6] },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  section: { gap: theme.spacing[3] },
  heading: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.lg },
  field: { gap: theme.spacing[1] },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  value: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
}));
