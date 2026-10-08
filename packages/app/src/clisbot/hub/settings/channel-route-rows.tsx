import { useChannelRouteWarnings } from "./channel-settings-hooks";
import { routeAudienceDraft, type InheritedConditions } from "./channel-route-audience";
import { ruleSummary, type AudienceNames } from "./channel-route-rule-summary";
import type { TFunction } from "i18next";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/ui/status-badge";
import { hostConnectionPresentation } from "@/clisbot/hub/channel-host-connection";
import { useRouteHost } from "./route-host-context";
import { ArrowDown, ArrowUp, Plus } from "lucide-react-native";
import { ChannelActionsMenu } from "./channel-actions-menu";
import { DrillChevron, DrillRow, keepPressInControl } from "./channel-list-rows";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { inheritedRuleConditions, type ChannelRouteBehavior } from "../channel-configuration";
import { HubObservedChannelConversationsSchema } from "../contracts";
import { EmptyRow } from "./access-settings-feedback";
import { channelRowStyles } from "./channel-settings-styles";
import {
  EMPTY_RECORD,
  type EditingRoute,
  type HubChannelConfiguration,
  type RecordValue,
} from "./channel-settings-types";
import { channelLabel, objectField, stringField } from "./channel-settings-records";
import { useAudienceNames, useObservedConversations } from "./channel-observed-conversations";
import { routeBehaviorDraft, routeToolRequestSummary } from "./channel-route-behavior-draft";

export function ChannelAccountRouteList({
  automationName,
  visible,
  account,
  accountKey,
  routes,
  resource,
  policy,
  warnings,
  canManage,
  pending,
  editRoute,
  moveRoute,
  removeRoute,
  addRoute,
}: {
  automationName?: string;
  visible: boolean;
  account: RecordValue;
  accountKey: string;
  routes: RecordValue[];
  resource?: RecordValue;
  /** The organization's `defaults:` a Rule inherits under the account's. */
  policy?: RecordValue | undefined;
  warnings?: HubChannelConfiguration["warnings"];
  canManage: boolean;
  pending: boolean;
  editRoute(route: EditingRoute): void;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  removeRoute(account: RecordValue, routeIndex: number): Promise<void>;
  /** Offered on the empty row: a Connection's first Route. */
  addRoute?: () => void;
}) {
  const { t } = useTranslation();
  const inherited = useMemo(
    () =>
      inheritedRuleConditions([
        objectField(policy ?? EMPTY_RECORD, "defaults") ?? undefined,
        objectField(account, "defaults") ?? undefined,
      ]),
    [account, policy],
  );
  const metadata = useObservedConversations(
    stringField(account, "channel"),
    stringField(account, "accountId"),
    visible,
  );
  if (!visible) return null;
  if (routes.length === 0) {
    return (
      <View style={settingsStyles.rowBorder}>
        {addRoute === undefined ? (
          <EmptyRow message={t("hub.routes.rows.noRoutes")} />
        ) : (
          <NoRoutesRow pending={pending} addRoute={addRoute} />
        )}
      </View>
    );
  }
  const rows = routes.map((route, routeIndex) =>
    automationName !== undefined && route.workflow !== automationName ? null : (
      <ChannelRouteRow
        key={`${accountKey}:route:${String(routeIndex)}`}
        automationScoped={automationName !== undefined}
        account={account}
        accountKey={accountKey}
        route={route}
        resource={resource ?? EMPTY_RECORD}
        inherited={inherited}
        metadata={metadata.data}
        warnings={warnings}
        routeIndex={routeIndex}
        routeCount={routes.length}
        canManage={canManage}
        pending={pending}
        editRoute={editRoute}
        moveRoute={moveRoute}
        removeRoute={removeRoute}
      />
    ),
  );
  return rows;
}

/**
 * One Route in two lines: who may talk and where, then what answers and how.
 * Its number shows only when there is an order to read, so a Connection's
 * single Route does not read "Route 1".
 */
function ChannelRouteRow({
  automationScoped,
  account,
  accountKey,
  route,
  resource,
  inherited,
  metadata,
  warnings: accountWarnings,
  routeIndex,
  routeCount,
  canManage,
  pending,
  editRoute,
  moveRoute,
  removeRoute,
}: {
  automationScoped: boolean;
  account: RecordValue;
  accountKey: string;
  route: RecordValue;
  resource: RecordValue;
  inherited: InheritedConditions;
  metadata: z.infer<typeof HubObservedChannelConversationsSchema> | undefined;
  warnings: HubChannelConfiguration["warnings"];
  routeIndex: number;
  routeCount: number;
  canManage: boolean;
  pending: boolean;
  editRoute(route: EditingRoute): void;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  removeRoute(account: RecordValue, routeIndex: number): Promise<void>;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const names = useAudienceNames(metadata);
  const [showWarnings, setShowWarnings] = useState(false);
  const toggleWarnings = useCallback(() => setShowWarnings((value) => !value), []);
  const edit = useCallback(() => {
    editRoute({ accountKey, routeIndex });
  }, [accountKey, editRoute, routeIndex]);
  const menu = useRouteMenu({
    account,
    routeIndex,
    routeCount,
    automationScoped,
    moveRoute,
    removeRoute,
  });
  const warnings = useChannelRouteWarnings(
    accountWarnings,
    stringField(account, "channel"),
    stringField(account, "accountId"),
    routeIndex,
  );
  const rowStyle = [settingsStyles.row, settingsStyles.rowBorder, styles.routeRow];
  // A Route is where messages go: named by its destination, its Rules under it.
  const body = (
    <>
      <View style={[channelRowStyles.row, compact && channelRowStyles.stackedRow]}>
        <View style={settingsStyles.rowContent}>
          <RouteDestinationLine
            number={routeCount > 1 ? routeIndex + 1 : null}
            route={route}
            resource={resource}
          />
          {routeRuleLines(route, names, inherited).map(({ id, line }) => (
            <Text key={id} style={styles.routeRule} numberOfLines={compact ? 2 : 1}>
              {line}
            </Text>
          ))}
          <RouteDetailLine route={route} />
        </View>
        {canManage ? (
          <View style={styles.routeActions}>
            {warnings.length === 0 ? null : (
              <Button
                size="xs"
                variant="ghost"
                onPressIn={keepPressInControl}
                onPress={toggleWarnings}
              >
                {t("hub.routes.rows.warnings", { count: warnings.length })}
              </Button>
            )}
            <ChannelActionsMenu
              label={t("hub.routes.rows.actions", { number: routeIndex + 1 })}
              disabled={pending}
              actions={menu.actions}
              remove={menu.remove}
            />
            <DrillChevron />
          </View>
        ) : null}
      </View>
      {showWarnings ? (
        <Alert
          variant="warning"
          title={t("hub.routes.rows.warnings", { count: warnings.length })}
          description={warnings.join("\n")}
        />
      ) : null}
    </>
  );
  if (!canManage) return <View style={rowStyle}>{body}</View>;
  return (
    <DrillRow
      label={
        automationScoped
          ? t("hub.routes.rows.editInput")
          : t("hub.routes.editor.editRoute", { number: routeIndex + 1 })
      }
      style={rowStyle}
      disabled={pending}
      onPress={edit}
    >
      {body}
    </DrillRow>
  );
}

/** Reordering lives in the Route's menu, offered only where there is an order. */
function useRouteMenu({
  account,
  routeIndex,
  routeCount,
  automationScoped,
  moveRoute,
  removeRoute,
}: {
  account: RecordValue;
  routeIndex: number;
  routeCount: number;
  automationScoped: boolean;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  removeRoute(account: RecordValue, routeIndex: number): Promise<void>;
}) {
  const { t } = useTranslation();
  return useMemo(() => {
    const reorder = !automationScoped && routeCount > 1;
    return {
      actions: [
        ...(reorder && routeIndex > 0
          ? [
              {
                label: t("hub.routes.rows.moveUp"),
                icon: ArrowUp,
                onSelect: () => void moveRoute(account, routeIndex, routeIndex - 1),
              },
            ]
          : []),
        ...(reorder && routeIndex < routeCount - 1
          ? [
              {
                label: t("hub.routes.rows.moveDown"),
                icon: ArrowDown,
                onSelect: () => void moveRoute(account, routeIndex, routeIndex + 1),
              },
            ]
          : []),
      ],
      remove: () => void removeRoute(account, routeIndex),
    };
  }, [account, automationScoped, moveRoute, removeRoute, routeCount, routeIndex, t]);
}

/**
 * What answers and how, in one muted line: the Agent or Automation, the Host
 * it runs on, the reply method and permission choice, and limits once set. A
 * Host the Hub cannot reach is the one fact that gets a badge.
 */
/**
 * Where the Route sends messages: the Agent or Automation and the Host it
 * runs on. A Host the Hub cannot reach is the one fact that gets a badge.
 */
function RouteDestinationLine({
  number,
  route,
  resource,
}: {
  /** Shown only when the Connection has more than one Route. */
  number: number | null;
  route: RecordValue;
  resource: RecordValue;
}) {
  const { t } = useTranslation();
  const host = useRouteHost(route);
  const offline = host !== null && !host.connected;
  const target = routeTargetLabel(t, route, resource);
  const destination =
    host === null || offline ? target : t("hub.routes.rows.onHost", { target, host: host.label });
  return (
    <View style={styles.routeDetail}>
      <Text style={[styles.routeTitle, styles.routeDetailText]} numberOfLines={2}>
        {number === null ? destination : t("hub.routes.rows.numbered", { number, destination })}
      </Text>
      {offline ? <StatusBadge {...hostConnectionPresentation(host)} /> : null}
    </View>
  );
}

/** How the Route replies and asks: the Reply method, the permission choice, and limits once set. */
function RouteDetailLine({ route }: { route: RecordValue }) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const { behavior } = routeBehaviorDraft(route);
  const facts = [
    behavior.outboundPathInherited === true ? null : routeReplyShort(t, behavior.outboundPath),
    routeToolRequestSummary(route),
    Object.keys(objectField(route, "limits") ?? {}).length > 0
      ? t("hub.routes.rows.customLimits")
      : null,
  ].filter((fact): fact is string => fact !== null);
  if (facts.length === 0) return null;
  return (
    <Text style={settingsStyles.rowHint} numberOfLines={compact ? 2 : 1}>
      {facts.join(" · ")}
    </Text>
  );
}

function routeReplyShort(t: TFunction, outboundPath: ChannelRouteBehavior["outboundPath"]): string {
  if (outboundPath === "hybrid") return t("hub.routes.rows.replyShort.hybrid");
  if (outboundPath === "relay") return t("hub.routes.rows.replyShort.relay");
  return t("hub.routes.rows.replyShort.tool");
}

/**
 * The Agent a Route starts, by the name a reader knows: a shared Agent by its
 * name; one the form created for this Route alone (`channel-<account>`) by its
 * provider and model, since that generated name says nothing.
 */
function routeTargetLabel(t: TFunction, route: RecordValue, resource: RecordValue): string {
  const workflow = stringField(route, "workflow");
  if (workflow !== null) return t("hub.routes.rows.automationTarget", { name: workflow });
  const agent = stringField(route, "agent");
  if (agent === null) return t("hub.routes.rows.unavailableTarget");
  const record = objectField(objectField(resource, "agents") ?? EMPTY_RECORD, agent);
  const provider = stringField(record ?? EMPTY_RECORD, "provider");
  if (!agent.startsWith("channel-") || provider === null)
    return t("hub.routes.rows.agentTarget", { name: agent });
  const model = stringField(record ?? EMPTY_RECORD, "model");
  return model === null ? channelLabel(provider) : `${channelLabel(provider)} ${model}`;
}

/** A Connection's empty Routes, with the one thing to do next beside it. */
export function NoRoutesRow({ pending, addRoute }: { pending: boolean; addRoute(): void }) {
  const { t } = useTranslation();
  return (
    <View style={settingsStyles.row}>
      <Text style={[settingsStyles.rowHint, styles.shrink]}>{t("hub.routes.rows.noRoutes")}</Text>
      <Button size="sm" variant="ghost" leftIcon={Plus} disabled={pending} onPress={addRoute}>
        {t("hub.routes.editor.addRoute")}
      </Button>
    </View>
  );
}

/** One line per Rule of a Route row. */
function routeRuleLines(
  route: RecordValue,
  names: AudienceNames,
  inherited: InheritedConditions,
): { id: string; line: string }[] {
  // Two Rules can read alike; the occurrence keeps their keys apart and stable.
  const seen = new Map<string, number>();
  return routeAudienceDraft(route).map((rule) => {
    const line = ruleSummary(rule, names, inherited);
    const occurrence = (seen.get(line) ?? 0) + 1;
    seen.set(line, occurrence);
    return { id: `${line}#${String(occurrence)}`, line };
  });
}

const styles = StyleSheet.create((theme) => ({
  shrink: { flexShrink: 1 },
  routeRow: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: theme.spacing[2],
  },
  routeTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  routeRule: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  routeDetail: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[2],
    marginTop: theme.spacing[0.5],
  },
  routeDetailText: {
    flexShrink: 1,
  },
  routeActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[2],
  },
}));
