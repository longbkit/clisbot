import { z } from "zod";
import {
  getHostProjectId,
  hostProjectFromRoute,
  type HostProjectListItem,
} from "@/projects/host-projects";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";

/**
 * Home's last start: the Host and project the composer opens on. It is stored with the project's
 * placement, so a cold start shows it before the Host connects and loads its workspaces.
 */
export const REMEMBERED_START_STORAGE_KEY = "@clisbot:home-remembered-start:v1";

const RememberedStartSchema = z.object({
  serverId: z.string().trim().min(1),
  project: z
    .object({
      projectId: z.string().trim().min(1),
      sourceDirectory: z.string().trim().min(1),
      name: z.string(),
    })
    .nullable(),
  // The last workspace route when this start was stored. Opening another workspace afterwards
  // makes that workspace the start again, as it was before starts were stored.
  workspace: z.object({ serverId: z.string(), workspaceId: z.string() }).nullable(),
});

export type RememberedStart = z.infer<typeof RememberedStartSchema>;
export type RememberedProject = NonNullable<RememberedStart["project"]>;

export interface RememberedStartStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}

function parseStored(stored: string): RememberedStart | null {
  try {
    const result = RememberedStartSchema.safeParse(JSON.parse(stored));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function createRememberedStartStore(storage: RememberedStartStorage) {
  let start: RememberedStart | null = null;
  let hydrated = false;
  let hydration: Promise<void> | null = null;
  let revision = 0;
  const listeners = new Set<() => void>();

  function notify() {
    for (const listener of listeners) listener();
  }

  function remember(next: RememberedStart) {
    if (JSON.stringify(next) === JSON.stringify(start)) return;
    start = next;
    revision += 1;
    notify();
    void storage.write(JSON.stringify(next)).catch(() => undefined);
  }

  function applyStored(stored: string | null) {
    start = stored === null ? null : parseStored(stored);
    if (stored !== null && start === null) void storage.clear().catch(() => undefined);
  }

  function hydrate(): Promise<void> {
    if (hydration) return hydration;
    const startedAt = revision;
    hydration = storage
      .read()
      .then((stored) => {
        // A choice made while the read was in flight is newer than what it returns.
        if (revision === startedAt) applyStored(stored);
        return undefined;
      })
      .catch(() => undefined)
      .finally(() => {
        hydrated = true;
        notify();
      });
    return hydration;
  }

  return {
    get: () => start,
    hydrate,
    isHydrated: () => hydrated,
    remember,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface ResolvedStart {
  serverId: string;
  project: HostProjectListItem | null;
}

function sameWorkspace(
  left: ActiveWorkspaceSelection | null,
  right: ActiveWorkspaceSelection | null,
): boolean {
  return left?.serverId === right?.serverId && left?.workspaceId === right?.workspaceId;
}

/** No workspace was opened since the start was stored, so it is still the latest choice. */
export function isStoredStartCurrent(
  stored: RememberedStart | null,
  lastWorkspace: ActiveWorkspaceSelection | null,
): stored is RememberedStart {
  return (
    stored !== null && (lastWorkspace === null || sameWorkspace(stored.workspace, lastWorkspace))
  );
}

function storedProject(
  serverId: string,
  project: RememberedProject,
  live: HostProjectListItem | null,
): HostProjectListItem | null {
  if (live && getHostProjectId(live, serverId) === project.projectId) return live;
  return hostProjectFromRoute({
    serverId,
    projectId: project.projectId,
    sourceDirectory: project.sourceDirectory,
    displayName: project.name,
  });
}

/**
 * The start Home opens on. The stored start wins while no other workspace was opened since it was
 * stored; otherwise the last workspace decides, with its project once its Host has loaded it.
 */
export function resolveRememberedStart(input: {
  stored: RememberedStart | null;
  lastWorkspace: ActiveWorkspaceSelection | null;
  liveProject: HostProjectListItem | null;
}): ResolvedStart | null {
  const { stored, lastWorkspace, liveProject } = input;
  if (isStoredStartCurrent(stored, lastWorkspace)) {
    const project = stored.project
      ? storedProject(stored.serverId, stored.project, liveProject)
      : null;
    return { serverId: stored.serverId, project };
  }
  if (lastWorkspace) return { serverId: lastWorkspace.serverId, project: liveProject };
  return null;
}

/**
 * A remembered project is dropped only once its Host has answered without it: online, its
 * workspaces loaded, and no project with that id. Until then it stays selected.
 */
export function isRememberedProjectGone(input: {
  start: ResolvedStart | null;
  projects: readonly HostProjectListItem[];
  online: boolean;
  hydrated: boolean;
}): boolean {
  const { start, projects, online, hydrated } = input;
  const projectId = start?.project ? getHostProjectId(start.project, start.serverId) : null;
  if (!start || !projectId || !online || !hydrated) return false;
  return !projects.some((project) => getHostProjectId(project, start.serverId) === projectId);
}

export function rememberedProjectOf(
  project: HostProjectListItem,
  serverId: string,
  sourceDirectory: string | null,
): RememberedProject | null {
  const projectId = getHostProjectId(project, serverId);
  const directory = sourceDirectory ?? project.iconWorkingDir;
  if (!projectId || !directory) return null;
  return { projectId, sourceDirectory: directory, name: project.projectName };
}
