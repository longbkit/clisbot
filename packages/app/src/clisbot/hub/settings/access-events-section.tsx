import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { i18n } from "@/i18n/i18next";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { HubAccessEventsSchema } from "../contracts";
import { assignmentSubjectName } from "./access-grant-rows";
import { resourceKey, type AccessAssignment, type AccessResource } from "./access-catalog";
import { canShareResource, type ViewerAuthority } from "./access-grantor";
import { EmptyRow, QueryFeedback } from "./access-settings-feedback";
import { accessSettingsStyles as styles } from "./access-settings-styles";
import { useHubResource } from "./hub-resource";

type AccessEvent = z.infer<typeof HubAccessEventsSchema>["events"][number];

const EVENTS_RESOURCE = "access-events?limit=20";

interface EventContext {
  resources: AccessResource[];
  assignments: AccessAssignment[];
  authority: ViewerAuthority;
  memberNameByUserId: Map<string, string>;
  teamById: Map<string, string>;
  memberById: Map<string, string>;
}

/**
 * What Organization Admins are told about: Administrator granted on a Host, and
 * Automations the Hub paused. Collapsed by default: it is a review list, not
 * something to act on daily.
 */
export function AccessEventsSection({
  pending,
  remove,
  ...context
}: EventContext & { pending: boolean; remove(assignmentId: string): Promise<void> }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((current) => !current), []);
  const events = useHubResource(EVENTS_RESOURCE, HubAccessEventsSchema, expanded);
  const trailing = useMemo(
    () => (
      <Button size="sm" variant="ghost" onPress={toggle}>
        {expanded ? t("hub.access.events.hide") : t("hub.access.events.show")}
      </Button>
    ),
    [expanded, t, toggle],
  );
  return (
    <SettingsSection
      title={t("hub.access.events.title")}
      info={t("hub.access.events.info")}
      trailing={trailing}
    >
      <View style={settingsStyles.card}>
        {expanded ? null : (
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>{t("hub.access.events.collapsedHint")}</Text>
          </View>
        )}
        {expanded ? <QueryFeedback queries={[events]} /> : null}
        {expanded && events.data?.events.length === 0 ? (
          <EmptyRow message={t("hub.access.events.empty")} />
        ) : null}
        {expanded
          ? events.data?.events.map((event) => (
              <AccessEventRow
                key={event.id}
                event={event}
                context={context}
                pending={pending}
                remove={remove}
              />
            ))
          : null}
      </View>
    </SettingsSection>
  );
}

function AccessEventRow({
  event,
  context,
  pending,
  remove,
}: {
  event: AccessEvent;
  context: EventContext;
  pending: boolean;
  remove(assignmentId: string): Promise<void>;
}) {
  const { t } = useTranslation();
  const revocable = revocableAdministratorGrant(event, context);
  const revoke = useCallback(() => {
    if (revocable !== undefined) void remove(revocable.id);
  }, [remove, revocable]);
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder, styles.row]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{describeAccessEvent(event, context)}</Text>
        <Text style={settingsStyles.rowHint}>{new Date(event.createdAt).toLocaleString()}</Text>
      </View>
      {revocable === undefined ? null : (
        <Button size="xs" variant="ghost" disabled={pending} onPress={revoke}>
          {t("hub.access.events.revoke")}
        </Button>
      )}
    </View>
  );
}

export function describeAccessEvent(event: AccessEvent, context: EventContext): string {
  const resource = context.resources.find(
    (candidate) =>
      resourceKey(candidate) === resourceKey({ kind: event.resourceKind, id: event.resourceId }),
  );
  const resourceName = resource?.name ?? event.resourceId;
  const subject = assignmentSubjectName(
    { kind: event.subjectKind, id: event.subjectId },
    context.teamById,
    context.memberById,
  );
  if (event.kind === "automation_paused") {
    return i18n.t("hub.access.events.automationPaused", { resource: resourceName, subject });
  }
  const actor =
    event.actorUserId === null
      ? i18n.t("hub.access.grantor.hub")
      : context.memberNameByUserId.get(event.actorUserId);
  return actor === undefined
    ? i18n.t("hub.access.events.administratorGrantedByFormerMember", {
        resource: resourceName,
        subject,
      })
    : i18n.t("hub.access.events.administratorGranted", { actor, resource: resourceName, subject });
}

/**
 * The grant an Administrator event is about, while it still holds Administrator
 * and the viewer may remove it; undefined otherwise.
 */
export function revocableAdministratorGrant(
  event: AccessEvent,
  context: Pick<EventContext, "assignments" | "authority" | "resources">,
): AccessAssignment | undefined {
  if (event.kind !== "administrator_granted") return undefined;
  const grant = context.assignments.find(
    (assignment) =>
      assignment.subjectKind === event.subjectKind &&
      assignment.subjectId === event.subjectId &&
      assignment.resourceKind === event.resourceKind &&
      assignment.resourceId === event.resourceId &&
      assignment.privileges.includes("daemon.manage"),
  );
  if (grant === undefined) return undefined;
  const target = { kind: grant.resourceKind, id: grant.resourceId, parent: null };
  return canShareResource(context.authority, target, context.resources) ? grant : undefined;
}
