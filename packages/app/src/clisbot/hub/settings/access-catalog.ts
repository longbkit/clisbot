import type { z } from "zod";
import type { SelectFieldOption } from "@/components/ui/select-field";
import type {
  HubAccessAssignmentsSchema,
  HubAccessCatalogSchema,
  HubMembersSchema,
  HubTeamsSchema,
} from "../contracts";

export type AccessCatalog = z.infer<typeof HubAccessCatalogSchema>;
export type AccessResource = AccessCatalog["resources"][number];
export type AccessResourceKind = AccessResource["kind"];
export type SubjectKind = "team" | "member" | "guest";
export type AccessAssignment = z.infer<typeof HubAccessAssignmentsSchema>["assignments"][number];
export type HubMember = z.infer<typeof HubMembersSchema>["members"][number];
export type HubTeam = z.infer<typeof HubTeamsSchema>["teams"][number];
export type AgentConfigurationCatalog = NonNullable<AccessResource["agentConfigurationCatalog"]>;

/** Also accepts a raw kind, so a route param can address a resource before the catalog loads. */
export function resourceKey(resource: { kind: string; id: string }): string {
  return `${resource.kind}\0${resource.id}`;
}

export function assignmentResourceOptions(
  resources: AccessResource[],
  availableOnly: boolean,
): SelectFieldOption<string>[] {
  const names = new Map(resources.map((resource) => [resourceKey(resource), resource.name]));
  const groups = {
    organization: "Organizations",
    daemon: "Hosts",
    project: "Projects",
    team: "Teams",
    channel_account: "Connections",
    automation: "Automations",
  };
  return resources
    .filter(({ kind, available }) => kind !== "organization" && (!availableOnly || available))
    .map((resource) => {
      const parent = resource.parent
        ? (names.get(resourceKey(resource.parent)) ?? resource.parent.id)
        : null;
      return {
        id: resourceKey(resource),
        value: resourceKey(resource),
        label: resource.name,
        group: groups[resource.kind],
        description:
          [parent, !resource.available ? "Unavailable" : null].filter(Boolean).join(" · ") ||
          resourceKindLabel(resource.kind),
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
      description: `${String(team.userIds.length)} ${team.userIds.length === 1 ? "Member" : "Members"}`,
      group: "Teams",
    })),
    ...members
      .filter(({ role }) => role !== "owner")
      .map((member) => ({
        id: `member:${member.id}`,
        value: subjectKey("member", member.id),
        label: `${member.name} · ${member.email}`,
        description: member.email,
        group: "Members",
      })),
    {
      id: "guest:guest",
      value: subjectKey("guest", "guest"),
      label: "Guest",
      description: "Channel senders without a linked Member",
      group: "Guest",
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
    organization: "Organization",
    daemon: "Host",
    project: "Project",
    team: "Team",
    channel_account: "Connection",
    automation: "Automation",
  }[kind];
}

export function accessLevelLabel(value: string): string {
  return (
    {
      current: "Current privileges",
      connect: "Connect",
      administrator: "Administrator",
      office_worker: "Office worker",
      developer: "Developer",
      full_access: "Full access",
      use: "Use",
      // The wire key stays `manage`; the scope is always named (Connection Admin).
      manage: "Admin",
      admin: "Admin",
      run: "Run",
    }[value] ?? value
  );
}

export function privilegeLabel(value: string): string {
  return value.replaceAll(".", " ");
}

export function conversationLabel(value: string): string {
  return (
    {
      specific: "Specific conversations",
      direct_messages: "Direct messages",
      public_channels: "Public conversations",
      all: "All conversations",
    }[value] ?? value
  );
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
            ? `${String(ids.length)} specific conversation${ids.length === 1 ? "" : "s"}`
            : "Specific conversations",
        );
      } else {
        values.push(conversationLabel(kind));
      }
    }
  }
  const agentConfigurations = constraints["agentConfigurations"];
  if (Array.isArray(agentConfigurations)) {
    values.push(
      `${String(agentConfigurations.length)} Agent configuration${agentConfigurations.length === 1 ? "" : "s"}`,
    );
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
  if (userId === null) return "Hub";
  return memberNameByUserId.get(userId) ?? "Former Member";
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
