import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Text } from "react-native";
import { Alert } from "@/components/ui/alert";
import { settingsStyles } from "@/styles/settings";
import { DetailRow, OrganizationTitle } from "./organization-identity";

/** What an approved CLI credential can do, stated against the organization it acts in. */
const CLI_CREDENTIAL_IMPACTS = [
  "List Projects and read their configuration",
  "Install triggers and configuration",
  "Enroll Hosts; each enrolled Host joins this organization",
  "Start Automation runs",
] as const;

export interface CliAuthorizationSubject {
  organization: { name: string; slug: string };
  account: { email: string; roleLabel: string } | null;
  hubOrigin: string | null;
  code: string;
  expiresAt: string;
}

/**
 * The approval decision, organization first: which organization the CLI will act in, who is
 * approving, on which Hub, and what the credential can do there. The code comes last because
 * it only proves this is the terminal the user started.
 */
export function CliAuthorizationSummary(subject: CliAuthorizationSubject) {
  return (
    <View style={styles.stack}>
      <View style={[settingsStyles.card, styles.card]}>
        <Text style={styles.eyebrow}>CLI login for organization</Text>
        <OrganizationTitle name={subject.organization.name} />
        <DetailRow label="Organization ID" value={subject.organization.slug} />
        {subject.account ? (
          <DetailRow
            label="Approved by"
            value={`${subject.account.email} · ${subject.account.roleLabel}`}
          />
        ) : null}
        {subject.hubOrigin ? <DetailRow label="Hub" value={subject.hubOrigin} /> : null}
        <DetailRow label="Code" value={subject.code} hint="Must match the code in your terminal" />
        <DetailRow label="Request expires" value={formatExpiry(subject.expiresAt)} />
      </View>
      <Alert
        variant="warning"
        title={`This CLI will act for ${subject.organization.name}`}
        description={`${CLI_CREDENTIAL_IMPACTS.map((impact) => `• ${impact}`).join("\n")}\n\nThe credential stays valid until an owner or admin revokes it in Hub → Configuration → API keys.`}
      />
    </View>
  );
}

function formatExpiry(expiresAt: string): string {
  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime())
    ? expiresAt
    : date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create((theme) => ({
  stack: {
    gap: theme.spacing[3],
  },
  card: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  eyebrow: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
