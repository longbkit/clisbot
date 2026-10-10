import { useCallback } from "react";
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
      issue.status === "error" ? `Can't connect to ${issue.label}` : `${issue.label} is offline`;
    // Through a Hub there is no address to fix: Clisbot on that computer has to be running.
    const hint = issue.hubName
      ? `Make sure Clisbot is running on that computer and can reach ${issue.hubName}.`
      : "Open the Host to check its address, reconnect or remove it.";
    return { title, hint, action: "Details" };
  }
  if (issue.kind === "setup")
    return {
      title: `Finish setting up ${issue.name}`,
      hint: "Create its owner account so people and Hosts can join.",
      action: "Set up",
    };
  if (issue.kind === "signIn")
    return {
      title: `${issue.name} Hub needs you to sign in again`,
      hint: "Its Hosts are hidden until you do.",
      action: "Sign in",
    };
  return {
    title: `Can't reach ${issue.name} Hub`,
    hint: "Check your network, then try again.",
    action: "Retry",
  };
}

const HEADER = { title: "Connections" };

export function ConnectionIssuesSheet({
  issues,
  visible,
  onClose,
}: {
  issues: StripIssue[];
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <AdaptiveModalSheet
      header={HEADER}
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
        <Text style={settingsStyles.rowHint}>All connections are working.</Text>
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
