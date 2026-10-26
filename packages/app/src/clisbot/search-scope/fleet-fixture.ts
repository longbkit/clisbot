import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { HostProfile } from "@/types/host-connection";
import type { ProjectSummary, WorkspaceSummary } from "@/utils/projects";

/**
 * A synthetic company fleet for measuring search: one local Host and a Hub of sandboxes, the
 * same projects repeated across them, as companies with 10–100+ sandboxes have.
 */
export interface Fleet {
  hosts: HostProfile[];
  offline: Set<string>;
  projects: ProjectSummary[];
  agents: AggregatedAgent[];
}

export const FLEET_HUB_ORIGIN = "hub://company";
const PROJECT_NAMES = [
  "clisbot",
  "anyapp",
  "billing",
  "web",
  "mobile",
  "infra",
  "docs",
  "search",
  "payments",
  "auth",
  "data-pipeline",
  "notifications",
  "admin",
  "analytics",
  "gateway",
  "ml-models",
  "design-system",
  "cli",
  "relay",
  "desktop",
  "vexere-bms",
  "vexere-ams",
  "booking",
  "pricing",
  "support-bot",
  "release-tools",
  "monitoring",
  "sandbox-images",
  "terraform",
  "playground",
];
const TOPICS = ["release", "fix flaky test", "refactor", "review PR", "deploy", "migrate", "spike"];

function hostProfile(serverId: string, label: string, hub: boolean): HostProfile {
  const now = "2026-10-25T00:00:00.000Z";
  return {
    serverId,
    label,
    appearance: {} as HostProfile["appearance"],
    lifecycle: {},
    ...(hub
      ? {
          management: {
            kind: "hub",
            hubOrigin: FLEET_HUB_ORIGIN,
            organizationId: "org",
            daemonId: `daemon-${serverId}`,
          },
        }
      : {}),
    connections: [
      { id: `tcp:${serverId}`, type: "directTcp", endpoint: `10.0.${serverId.length}.1:6868` },
    ],
    preferredConnectionId: `tcp:${serverId}`,
    createdAt: now,
    updatedAt: now,
  };
}

function workspace(id: string, title: string, minutesAgo: number): WorkspaceSummary {
  return {
    id,
    name: title,
    title,
    workspaceKind: "worktree" as WorkspaceSummary["workspaceKind"],
    status: "done" as WorkspaceSummary["status"],
    currentBranch: `feat/${id}`,
    changeRequestNumber: null,
    statusEnteredAt: new Date(Date.UTC(2026, 9, 25, 12) - minutesAgo * 60_000),
  };
}

export function buildFleet(input: { hosts: number; sessions: number }): Fleet {
  const hosts: HostProfile[] = [hostProfile("local", "This Mac", false)];
  for (let index = 1; index < input.hosts; index += 1) {
    hosts.push(hostProfile(`sb${index}`, `sandbox-${String(index).padStart(2, "0")}`, true));
  }
  const offline = new Set(
    hosts.filter((_, index) => index % 10 === 9).map((host) => host.serverId),
  );
  const byName = new Map<string, ProjectSummary>();
  const placements: {
    serverId: string;
    serverName: string;
    name: string;
    workspaceIds: string[];
  }[] = [];
  hosts.forEach((host, hostIndex) => {
    const count = 3 + (hostIndex % 6);
    for (let offset = 0; offset < count; offset += 1) {
      const name = PROJECT_NAMES[(hostIndex * 7 + offset * 3) % PROJECT_NAMES.length]!;
      const workspaces = [0, 1].map((n) =>
        workspace(
          `${host.serverId}-${name}-${n}`,
          `${name} ${TOPICS[(hostIndex + n) % TOPICS.length]}`,
          hostIndex * 3 + n,
        ),
      );
      const summary = byName.get(name) ?? {
        viewKey: `view:${name}`,
        projectName: name,
        hosts: [],
        totalWorkspaceCount: 0,
        hostCount: 0,
        onlineHostCount: 0,
      };
      if (summary.hosts.some((entry) => entry.serverId === host.serverId)) continue;
      summary.hosts.push({
        serverId: host.serverId,
        projectId: `${host.serverId}:${name}`,
        projectName: name,
        projectCustomName: null,
        serverName: host.label,
        isOnline: !offline.has(host.serverId),
        repoRoot: `/home/dev/${name}`,
        workspaceCount: workspaces.length,
        workspaces,
      });
      summary.totalWorkspaceCount += workspaces.length;
      summary.hostCount += 1;
      byName.set(name, summary);
      placements.push({
        serverId: host.serverId,
        serverName: host.label,
        name,
        workspaceIds: workspaces.map((entry) => entry.id),
      });
    }
  });
  const agents: AggregatedAgent[] = [];
  for (let index = 0; index < input.sessions; index += 1) {
    const placement = placements[(index * 13) % placements.length]!;
    agents.push({
      id: `agent-${index}`,
      serverId: placement.serverId,
      serverLabel: placement.serverName,
      title: `${TOPICS[index % TOPICS.length]} ${placement.name} #${index}`,
      status: index % 17 === 0 ? "running" : "idle",
      lastActivityAt: new Date(Date.UTC(2026, 9, 25, 12) - index * 37_000),
      createdAt: new Date(Date.UTC(2026, 9, 1)),
      cwd: `/home/dev/${placement.name}`,
      workspaceId: placement.workspaceIds[index % 2] ?? null,
      provider: "codex",
      requiresAttention: index % 41 === 0,
      archivedAt: null,
      labels: {},
      projectPlacement: null,
    } as unknown as AggregatedAgent);
  }
  return { hosts, offline, projects: [...byName.values()], agents };
}
