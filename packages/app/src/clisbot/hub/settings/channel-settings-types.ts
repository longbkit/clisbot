import type { z } from "zod";
import { type ChannelConfigurationRecord } from "../channel-configuration";
import { type RouteBotRequest } from "../channel-route-bot";
import {
  HubAutomationsSchema,
  HubChannelConfigurationSchema,
  HubChannelRevisionsSchema,
  HubChannelRuntimeStatusSchema,
  HubConnectionsSchema,
  HubDaemonsSchema,
  HubTeamsSchema,
} from "../contracts";

export type RecordValue = ChannelConfigurationRecord;
export type RouteTarget = "bot" | "agent" | "automation";
export type ConfigurationKind = "account" | "route";
export type HubConnection = z.infer<typeof HubConnectionsSchema>["connections"][number];
export type HubConnections = z.infer<typeof HubConnectionsSchema>;
export type HubAutomation = z.infer<typeof HubAutomationsSchema>["automations"][number];
export type HubAutomations = z.infer<typeof HubAutomationsSchema>;
export type HubDaemon = z.infer<typeof HubDaemonsSchema>["daemons"][number];
export type HubDaemons = z.infer<typeof HubDaemonsSchema>;
export type HubTeam = z.infer<typeof HubTeamsSchema>["teams"][number];
export type HubTeams = z.infer<typeof HubTeamsSchema>;
export type HubRuntimeAccount = z.infer<typeof HubChannelRuntimeStatusSchema>["accounts"][number];
export type HubRuntimeStatus = z.infer<typeof HubChannelRuntimeStatusSchema>;
export type HubRevision = z.infer<typeof HubChannelRevisionsSchema>["revisions"][number];
export type HubChannelConfiguration = z.infer<typeof HubChannelConfigurationSchema>;

export const EMPTY_RECORD: RecordValue = {};

export interface EditingRoute {
  accountKey: string;
  routeIndex: number;
}

/**
 * One Add Route flow. `accountKey` preselects a Connection; `fixed` means the
 * form was opened from that Connection's card, so it shows it instead of a
 * picker. `connect` is Add Connection: the same form, opened on its connect
 * step, so a new Connection is added together with its first Route.
 */
export type ChannelEditor =
  | {
      kind: "add";
      accountKey: string | null;
      fixed: boolean;
      connect?: boolean;
      /** A Connection with no Routes yet, preselected in the picker. */
      connectionId?: string;
      /** "Connect to a channel…" on a Bot: the Route starts on that Bot. */
      bot?: RouteBotRequest;
    }
  | { kind: "edit"; route: EditingRoute };

/** The organization-wide panels the Connections page opens from its menu. */
export type ConnectionsPanel = "history" | "yaml";
