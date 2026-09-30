import type { HubEnrollmentRequest } from "@clisbot/protocol/messages";
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
  enrollment?: HubEnrollmentRequest | null;
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
        <Text style={styles.eyebrow}>
          {subject.enrollment
            ? "Connect Host to organization"
            : "Advanced CLI access for organization"}
        </Text>
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
        {subject.enrollment ? (
          <>
            <DetailRow label="Host" value={subject.enrollment.hostname} />
            <DetailRow label="Host ID" value={subject.enrollment.serverId} />
            <DetailRow label="Host public key" value={subject.enrollment.daemonPublicKey} />
          </>
        ) : null}
      </View>
      <Alert
        variant="warning"
        title={
          subject.enrollment
            ? `Allow ${subject.organization.name} to use this Host`
            : `This CLI will act for ${subject.organization.name}`
        }
        description={
          subject.enrollment
            ? `Hub permissions on this Host: ${subject.enrollment.permissions.length ? subject.enrollment.permissions.join(", ") : "None"}.\n\nApproval allows one enrollment of this Host before the request expires. The Host then keeps its own connection credential. No CLI administration credential is created. Disconnect the Host to remove its local connection, or revoke it in Hub.`
            : `${CLI_CREDENTIAL_IMPACTS.map((impact) => `• ${impact}`).join("\n")}\n\nThe credential has no automatic expiry. An owner or admin must revoke it in Hub → Configuration → API keys. CLI logout only removes its local copy. Use hub connect for Host onboarding.`
        }
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
