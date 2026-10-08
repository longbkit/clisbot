import type { z } from "zod";
import type { SelectFieldOption } from "@/components/ui/select-field";
import type {
  HubAccessAssignmentsSchema,
  HubAccessCatalogSchema,
  HubMembersSchema,
  HubTeamsSchema,
} from "../contracts";
import { withEmail } from "@/clisbot/hub/account-email";
import { i18n } from "@/i18n/i18next";

export type AccessCatalog = z.infer<typeof HubAccessCatalogSchema>;
export type AccessResource = AccessCatalog["resources"][number];
export type AccessResourceKind = AccessResource["kind"];
export type SubjectKind = "team" | "member" | "guest";
export type AccessAssignment = z.infer<typeof HubAccessAssignmentsSchema>["assignments"][number];
export type HubMember = z.infer<typeof HubMembersSchema>["members"][number];
export type HubTeam = z.infer<typeof HubTeamsSchema>["teams"][number];
export type AgentConfigurationCatalog = NonNullable<AccessResource["agentConfigurationCatalog"]>;

/** Also accepts a raw kind, so a route param can address a resource before the catalog loads. */
/** What being an Owner grants, said once for every screen that explains the role. */
export function ownerAccessHint(): string {
  return i18n.t("hub.access.ownerAccessHint");
}

export function resourceKey(resource: { kind: string; id: string }): string {
  return `${resource.kind}\0${resource.id}`;
}

/** A Project that is a Bot's home. The grant on it stays a Project grant; only the picker differs. */
export function isBotProject(resource: Pick<AccessResource, "kind" | "bot">): boolean {
  return resource.kind === "project" && resource.bot !== undefined;
}

export function assignmentResourceOptions(
  resources: AccessResource[],
  availableOnly: boolean,
): SelectFieldOption<string>[] {
  const names = new Map(resources.map((resource) => [resourceKey(resource), resource.name]));
  const groups = resourceKindPluralLabels();
  return resources
    .filter(({ kind, available }) => kind !== "organization" && (!availableOnly || available))
    .map((resource) => {
      const parent = resource.parent
        ? (names.get(resourceKey(resource.parent)) ?? resource.parent.id)
        : null;
      const bot = isBotProject(resource);
      return {
        id: resourceKey(resource),
        value: resourceKey(resource),
        label: resource.name,
        group: bot ? i18n.t("hub.access.kindsPlural.bot") : groups[resource.kind],
        description:
          [
            bot ? i18n.t("hub.access.kinds.bot") : null,
            parent,
            !resource.available ? i18n.t("hub.access.unavailable") : null,
          ]
            .filter(Boolean)
            .join(" · ") || resourceKindLabel(resource.kind),
      };
    });
}

export function assignmentSubjectOptions(
  members: HubMember[],
  teams: HubTeam[],
): SelectFieldOption<string>[] {
  return [
    ...teams.map((team) => ({
      id: `team:${team.id}`,
      value: subjectKey("team", team.id),
      label: team.name,
      description: i18n.t("hub.access.memberCount", { count: team.userIds.length }),
      group: i18n.t("hub.access.kindsPlural.team"),
    })),
    ...members
      .filter(({ role }) => role !== "owner")
      .map((member) => ({
        id: `member:${member.id}`,
        value: subjectKey("member", member.id),
        label: withEmail(member.name, member.email),
        description: member.email,
        group: i18n.t("hub.access.kindsPlural.member"),
      })),
    {
      id: "guest:guest",
      value: subjectKey("guest", "guest"),
      label: i18n.t("hub.access.kinds.guest"),
      description: i18n.t("hub.access.guestDescription"),
      group: i18n.t("hub.access.kinds.guest"),
    },
  ];
}

export function subjectKey(kind: SubjectKind, id: string): string {
  return `${kind}\0${id}`;
}

export function parseSubjectKey(value: string | null): { kind: SubjectKind; id: string } | null {
  if (value === null) return null;
  const separator = value.indexOf("\0");
  if (separator < 0) return null;
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (kind === "guest") return id === "guest" ? { kind, id } : null;
  return (kind === "team" || kind === "member") && id.length > 0 ? { kind, id } : null;
}

export function selectedOptionDisplay(
  options: SelectFieldOption<string>[],
  value: string | null,
): { label: string; description?: string } | null {
  const option = options.find((candidate) => candidate.value === value);
  return option === undefined
    ? null
    : {
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      };
}

export function resourceKindLabel(kind: AccessResourceKind): string {
  return {
    organization: () => i18n.t("hub.access.kinds.organization"),
    daemon: () => i18n.t("hub.access.kinds.daemon"),
    project: () => i18n.t("hub.access.kinds.project"),
    team: () => i18n.t("hub.access.kinds.team"),
    channel_account: () => i18n.t("hub.access.kinds.channelAccount"),
    automation: () => i18n.t("hub.access.kinds.automation"),
  }[kind]();
}

/** Resource kinds as list groups and filters: "Hosts", "Projects". */
export function resourceKindPluralLabels(): Record<AccessResourceKind, string> {
  return {
    organization: i18n.t("hub.access.kindsPlural.organization"),
    daemon: i18n.t("hub.access.kindsPlural.daemon"),
    project: i18n.t("hub.access.kindsPlural.project"),
    team: i18n.t("hub.access.kindsPlural.team"),
    channel_account: i18n.t("hub.access.kindsPlural.channelAccount"),
    automation: i18n.t("hub.access.kindsPlural.automation"),
  };
}

const ACCESS_LEVEL_LABELS: Record<string, () => string> = {
  current: () => i18n.t("hub.access.levels.current"),
  connect: () => i18n.t("hub.access.levels.connect"),
  administrator: () => i18n.t("hub.access.levels.administrator"),
  office_worker: () => i18n.t("hub.access.levels.officeWorker"),
  developer: () => i18n.t("hub.access.levels.developer"),
  full_access: () => i18n.t("hub.access.levels.fullAccess"),
  use: () => i18n.t("hub.access.levels.use"),
  // The wire key stays `manage`; the scope is always named (Connection Admin).
  manage: () => i18n.t("hub.access.levels.admin"),
  admin: () => i18n.t("hub.access.levels.admin"),
  run: () => i18n.t("hub.access.levels.run"),
};

export function accessLevelLabel(value: string): string {
  return ACCESS_LEVEL_LABELS[value]?.() ?? value;
}

export function privilegeLabel(value: string): string {
  return value.replaceAll(".", " ");
}

const CONVERSATION_LABELS: Record<string, () => string> = {
  specific: () => i18n.t("hub.access.conversations.specific"),
  direct_messages: () => i18n.t("hub.access.conversations.directMessages"),
  public_channels: () => i18n.t("hub.access.conversations.publicChannels"),
  all: () => i18n.t("hub.access.conversations.all"),
};

export function conversationLabel(value: string): string {
  return CONVERSATION_LABELS[value]?.() ?? value;
}

export function constraintSummary(constraints: Record<string, unknown>): string | null {
  const values: string[] = [];
  const conversation = constraints["conversation"];
  if (typeof conversation === "object" && conversation !== null) {
    const kind = Reflect.get(conversation, "kind");
    if (typeof kind === "string") {
      if (kind === "specific") {
        const ids = Reflect.get(conversation, "conversationIds");
        values.push(
          Array.isArray(ids)
            ? i18n.t("hub.access.constraints.specificConversations", { count: ids.length })
            : i18n.t("hub.access.conversations.specific"),
        );
      } else {
        values.push(conversationLabel(kind));
      }
    }
  }
  const agentConfigurations = constraints["agentConfigurations"];
  if (Array.isArray(agentConfigurations)) {
    values.push(
      i18n.t("hub.access.constraints.agentConfigurations", {
        count: agentConfigurations.length,
      }),
    );
  }
  const terminalProfiles = constraints["terminalProfiles"];
  if (terminalProfiles === "*") values.push(i18n.t("hub.access.constraints.allTerminalProfiles"));
  else if (Array.isArray(terminalProfiles)) {
    values.push(
      i18n.t("hub.access.constraints.terminalProfiles", { count: terminalProfiles.length }),
    );
  }
  if (typeof constraints["projectFolders"] === "object" && constraints["projectFolders"] !== null) {
    values.push(i18n.t("hub.access.constraints.narrowedProjectFolders"));
  }
  return values.length === 0 ? null : values.join(" · ");
}

/** Who made the grant, so it can be revoked at once. Null means the Hub itself wrote it. */
/** Member display names keyed by user id, for "by <grantor>" labels. */
export function memberNamesByUserId(
  members: readonly { userId: string; name: string }[],
): Map<string, string> {
  return new Map(members.map((member) => [member.userId, member.name]));
}

/** Who made a grant: a Member's name, or Hub for one the Hub wrote itself. */
export function grantorName(
  assignment: Pick<AccessAssignment, "createdByUserId">,
  memberNameByUserId: ReadonlyMap<string, string>,
): string {
  const userId = assignment.createdByUserId ?? null;
  if (userId === null) return i18n.t("hub.access.grantor.hub");
  return memberNameByUserId.get(userId) ?? i18n.t("hub.access.grantor.formerMember");
}

/** Assignments held by one subject, e.g. every grant to a Team. */
export function subjectAssignments<T extends Pick<AccessAssignment, "subjectKind" | "subjectId">>(
  assignments: readonly T[],
  subjectKind: SubjectKind,
  subjectId: string,
): T[] {
  return assignments.filter(
    (assignment) => assignment.subjectKind === subjectKind && assignment.subjectId === subjectId,
  );
}
