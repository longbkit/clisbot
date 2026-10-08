import type { HubEnrollmentRequest } from "@clisbot/protocol/messages";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Text } from "react-native";
import { Alert } from "@/components/ui/alert";
import { settingsStyles } from "@/styles/settings";
import { DetailRow, OrganizationTitle } from "./organization-identity";
import { withEmail } from "@/clisbot/hub/account-email";

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
  const { t } = useTranslation();
  const organization = subject.organization.name;
  return (
    <View style={styles.stack}>
      <View style={[settingsStyles.card, styles.card]}>
        <Text style={styles.eyebrow}>
          {subject.enrollment
            ? t("hub.account.cliSummary.connectHostEyebrow")
            : t("hub.account.cliSummary.advancedAccessEyebrow")}
        </Text>
        <OrganizationTitle name={organization} />
        <DetailRow
          label={t("hub.account.cliSummary.organizationId")}
          value={subject.organization.slug}
        />
        {subject.account ? (
          <DetailRow
            label={t("hub.account.cliSummary.approvedBy")}
            value={withEmail(subject.account.roleLabel, subject.account.email)}
          />
        ) : null}
        {subject.hubOrigin ? (
          <DetailRow label={t("hub.account.cliSummary.hub")} value={subject.hubOrigin} />
        ) : null}
        <DetailRow
          label={t("hub.account.cliSummary.code")}
          value={subject.code}
          hint={t("hub.account.cliSummary.codeHint")}
        />
        <DetailRow
          label={t("hub.account.cliSummary.requestExpires")}
          value={formatExpiry(subject.expiresAt)}
        />
        {subject.enrollment ? (
          <>
            <DetailRow
              label={t("hub.account.cliSummary.host")}
              value={subject.enrollment.hostname}
            />
            <DetailRow
              label={t("hub.account.cliSummary.hostId")}
              value={subject.enrollment.serverId}
            />
            <DetailRow
              label={t("hub.account.cliSummary.hostPublicKey")}
              value={subject.enrollment.daemonPublicKey}
            />
          </>
        ) : null}
      </View>
      <Alert
        variant="warning"
        title={
          subject.enrollment
            ? t("hub.account.cliSummary.allowHost", { organization })
            : t("hub.account.cliSummary.actFor", { organization })
        }
        description={
          subject.enrollment
            ? t("hub.account.cliSummary.hostPermissions", {
                permissions: permissionList(subject.enrollment, t),
              })
            : credentialImpacts(t)
        }
      />
    </View>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

function permissionList(enrollment: HubEnrollmentRequest, t: Translate): string {
  return enrollment.permissions.length
    ? enrollment.permissions.join(", ")
    : t("hub.account.cliSummary.noPermissions");
}

/** What an approved CLI credential can do, stated against the organization it acts in. */
function credentialImpacts(t: Translate): string {
  const impacts = [
    t("hub.account.cliSummary.impacts.listProjects"),
    t("hub.account.cliSummary.impacts.installTriggers"),
    t("hub.account.cliSummary.impacts.enrollHosts"),
    t("hub.account.cliSummary.impacts.startRuns"),
  ];
  return `${impacts.map((impact) => `• ${impact}`).join("\n")}\n\n${t("hub.account.cliSummary.credentialNotice")}`;
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
