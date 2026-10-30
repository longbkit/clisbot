import {
  normalizeProjectDescriptor,
  normalizeWorkspaceDescriptor,
  type Agent,
} from "@/stores/session-store";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { ReplicaCache, type DirectoryReplicaMutation } from ".";
import { MemoryStorage } from "./testing";

/** The 2026-10-30 Galaxy S23 fleet: 14 Hub Hosts and about 6,100 sessions in all. */
export const FLEET_HOSTS = 14;
export const FLEET_AGENTS_PER_HOST = 440;
export const FLEET_WORKSPACES_PER_HOST = 40;
export const FLEET_PROJECTS_PER_HOST = 5;
/** Agent, workspace and project rows plus the checkpoint, per Host. */
export const FLEET_ROWS_PER_HOST =
  FLEET_AGENTS_PER_HOST + FLEET_WORKSPACES_PER_HOST + FLEET_PROJECTS_PER_HOST + 1;

export function fleetServerId(index: number): string {
  return `srv_sandbox_${index}`;
}

export function fleetServerIds(hosts = FLEET_HOSTS): string[] {
  return Array.from({ length: hosts }, (_, index) => fleetServerId(index));
}

function fleetAgent(serverId: string, index: number): Agent {
  const workspaceId = `workspace-${index % FLEET_WORKSPACES_PER_HOST}`;
  return {
    ...normalizeAgentSnapshot(
      {
        id: `agent-${index}`,
        provider: "codex",
        cwd: `/repo/${workspaceId}`,
        workspaceId,
        model: "gpt-5",
        createdAt: "2026-10-20T08:00:00.000Z",
        updatedAt: new Date(Date.UTC(2026, 9, 29, 8, index % 60)).toISOString(),
        lastUserMessageAt: "2026-10-29T08:00:00.000Z",
        status: "idle",
        capabilities: {
          supportsStreaming: true,
          supportsSessionPersistence: true,
          supportsDynamicModes: true,
          supportsMcpServers: true,
          supportsReasoningStream: true,
          supportsToolInvocations: true,
        },
        currentModeId: null,
        availableModes: [],
        pendingPermissions: [],
        persistence: null,
        title: `Session ${index} on ${serverId}`,
        labels: {},
      },
      serverId,
    ),
    projectPlacement: null,
  };
}

function fleetMutations(serverId: string): DirectoryReplicaMutation[] {
  const mutations: DirectoryReplicaMutation[] = [];
  for (let index = 0; index < FLEET_PROJECTS_PER_HOST; index += 1) {
    const project = normalizeProjectDescriptor({
      projectId: `project-${index}`,
      projectDisplayName: `Project ${index}`,
      projectRootPath: `/repo/project-${index}`,
      projectKind: "git",
    });
    mutations.push({ kind: "project", type: "upsert", id: project.projectId, value: project });
  }
  for (let index = 0; index < FLEET_WORKSPACES_PER_HOST; index += 1) {
    const workspace = normalizeWorkspaceDescriptor({
      id: `workspace-${index}`,
      projectId: `project-${index % FLEET_PROJECTS_PER_HOST}`,
      projectDisplayName: `Project ${index % FLEET_PROJECTS_PER_HOST}`,
      projectRootPath: `/repo/project-${index % FLEET_PROJECTS_PER_HOST}`,
      workspaceDirectory: `/repo/workspace-${index}`,
      projectKind: "git",
      workspaceKind: "local_checkout",
      name: `workspace-${index}`,
      status: "running",
      statusEnteredAt: "2026-10-29T08:00:00.000Z",
      activityAt: null,
      archivingAt: null,
      diffStat: null,
      scripts: [],
    });
    mutations.push({ kind: "workspace", type: "upsert", id: workspace.id, value: workspace });
  }
  for (let index = 0; index < FLEET_AGENTS_PER_HOST; index += 1) {
    const agent = fleetAgent(serverId, index);
    mutations.push({ kind: "agent", type: "upsert", id: agent.id, value: agent });
  }
  return mutations;
}

/** A row store holding what the last run cached for every Host of the fleet. */
export async function cachedFleetStorage(serverIds = fleetServerIds()): Promise<MemoryStorage> {
  const storage = new MemoryStorage();
  const writer = new ReplicaCache(storage, { clearLegacyCache: async () => undefined });
  writer.setHosts(serverIds);
  for (const serverId of serverIds) {
    writer.commitDirectoryMutations(serverId, fleetMutations(serverId), {
      agents: { generation: "g", afterSeq: 1 },
    });
  }
  await writer.flush();
  return storage;
}
