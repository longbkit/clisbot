import { i18n } from "@/i18n/i18next";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { openHostOverview } from "@/navigation/settings-navigation";
import { settingsStyles } from "@/styles/settings";
import type { StripIssue } from "./hosts-strip-model";
import { useOpenHub } from "./hosts-strip-data";

/** What each connection problem is, and the one action that addresses it. */
export function issueCopy(issue: StripIssue): { title: string; hint: string; action: string } {
  if (issue.kind === "host") {
    const title =
      issue.status === "error"
        ? i18n.t("home.connections.cantConnect", { name: issue.label })
        : i18n.t("home.connections.offline", { name: issue.label });
    // Through a Hub there is no address to fix: Clisbot on that computer has to be running.
    const hint = issue.hubName
      ? i18n.t("home.connections.hubHostHint", { hub: issue.hubName })
      : i18n.t("home.connections.hostHint");
    return { title, hint, action: i18n.t("home.connections.details") };
  }
  if (issue.kind === "setup")
    return {
      title: i18n.t("home.connections.finishSetup", { name: issue.name }),
      hint: i18n.t("home.connections.setupHint"),
      action: i18n.t("home.connections.setUp"),
    };
  if (issue.kind === "signIn")
    return {
      title: i18n.t("home.connections.signInAgain", { name: issue.name }),
      hint: i18n.t("home.connections.signInHint"),
      action: i18n.t("home.connections.signIn"),
    };
  return {
    title: i18n.t("home.connections.cantReachHub", { name: issue.name }),
    hint: i18n.t("home.connections.cantReachHint"),
    action: i18n.t("home.connections.retry"),
  };
}

export function ConnectionIssuesSheet({
  issues,
  visible,
  onClose,
}: {
  issues: StripIssue[];
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const header = useMemo(() => ({ title: t("home.connections.title") }), [t]);
  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      testID="home-connection-issues-sheet"
    >
      {issues.length ? (
        <View style={settingsStyles.card}>
          {issues.map((issue, index) => (
            <IssueRow
              key={issue.kind === "host" ? issue.serverId : `${issue.kind}:${issue.origin}`}
              issue={issue}
              first={index === 0}
              onDone={onClose}
            />
          ))}
        </View>
      ) : (
        <Text style={settingsStyles.rowHint}>{t("home.connections.allWorking")}</Text>
      )}
    </AdaptiveModalSheet>
  );
}

function IssueRow({
  issue,
  first,
  onDone,
}: {
  issue: StripIssue;
  first: boolean;
  onDone: () => void;
}) {
  const openHub = useOpenHub();
  const copy = issueCopy(issue);
  const act = useCallback(() => {
    if (issue.kind === "host") {
      onDone();
      openHostOverview(issue.serverId);
      return;
    }
    if (issue.kind === "setup")
      return {
        title: `Finish setting up ${issue.name}`,
        hint: "Create its owner account so people and Hosts can join.",
        action: "Set up",
      };
    if (issue.kind === "signIn") onDone();
    void openHub(issue.origin, issue.kind === "signIn" ? "account" : "retry");
  }, [issue, onDone, openHub]);
  return (
    <View style={first ? settingsStyles.row : [settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{copy.title}</Text>
        <Text style={settingsStyles.rowHint}>{copy.hint}</Text>
      </View>
      <Button variant="outline" size="sm" onPress={act}>
        {copy.action}
      </Button>
    </View>
  );
}
