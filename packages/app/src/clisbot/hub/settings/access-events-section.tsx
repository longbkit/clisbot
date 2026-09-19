import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { HubAccessEventsSchema } from "../contracts";
import { assignmentSubjectName } from "./access-assignment-list";
import { resourceKey, type AccessResource } from "./access-catalog";
import { EmptyRow, QueryFeedback } from "./access-settings-feedback";
import { accessSettingsStyles as styles } from "./access-settings-styles";
import { useHubResource } from "./hub-resource";

type AccessEvent = z.infer<typeof HubAccessEventsSchema>["events"][number];

const EVENTS_RESOURCE = "access-events?limit=20";

/**
 * Who granted Administrator on which Host to whom, for Organization Admins.
 * Collapsed by default: it is a review list, not something to act on daily.
 */
export function AccessEventsSection({
  resources,
  memberNameByUserId,
  teamById,
  memberById,
}: {
  resources: AccessResource[];
  memberNameByUserId: Map<string, string>;
  teamById: Map<string, string>;
  memberById: Map<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((current) => !current), []);
  const events = useHubResource(EVENTS_RESOURCE, HubAccessEventsSchema, expanded);
  const resourceNames = new Map(resources.map((resource) => [resourceKey(resource), resource]));
  const describe = (event: AccessEvent) => {
    const actor = event.actorUserId === null ? "Hub" : memberNameByUserId.get(event.actorUserId);
    const resource = resourceNames.get(
      resourceKey({ kind: event.resourceKind, id: event.resourceId }),
    );
    const subject = assignmentSubjectName(
      { kind: event.subjectKind, id: event.subjectId },
      teamById,
      memberById,
    );
    return `${actor ?? "A former Member"} granted Administrator on ${resource?.name ?? event.resourceId} to ${subject}`;
  };
  return (
    <SettingsSection title="Administrator grants">
      <View style={settingsStyles.card}>
        <View style={[settingsStyles.row, styles.row]}>
          <Button
            size="xs"
            variant="ghost"
            leftIcon={expanded ? ChevronDown : ChevronRight}
            onPress={toggle}
            accessibilityLabel={
              expanded ? "Hide Administrator grants" : "Show Administrator grants"
            }
          />
          <Text style={settingsStyles.rowHint}>
            Every Administrator grant on a Host, with who made it. Organization Admins are also
            notified.
          </Text>
        </View>
        {expanded ? <QueryFeedback queries={[events]} /> : null}
        {expanded && events.data?.events.length === 0 ? (
          <EmptyRow message="No Administrator grants yet." />
        ) : null}
        {expanded
          ? events.data?.events.map((event) => (
              <View key={event.id} style={[settingsStyles.row, settingsStyles.rowBorder]}>
                <View style={settingsStyles.rowContent}>
                  <Text style={settingsStyles.rowTitle}>{describe(event)}</Text>
                  <Text style={settingsStyles.rowHint}>
                    {new Date(event.createdAt).toLocaleString()}
                  </Text>
                </View>
              </View>
            ))
          : null}
      </View>
    </SettingsSection>
  );
}
