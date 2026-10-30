import { describe, expect, it } from "vitest";
import type { HostProjectListItem } from "@/projects/host-projects";
import { createProjectViewKey } from "@/projects/workspace-structure";
import {
  createRememberedStartStore,
  isRememberedProjectGone,
  resolveRememberedStart,
  type RememberedStart,
  type RememberedStartStorage,
} from "./remembered-start";

function memoryStorage(initial: string | null = null) {
  let value = initial;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const storage: RememberedStartStorage = {
    read: async () => {
      await gate;
      return value;
    },
    write: async (next) => {
      value = next;
    },
    clear: async () => {
      value = null;
    },
  };
  return { storage, release, current: () => value };
}

const VAI: RememberedStart = {
  serverId: "uat-ai-team",
  project: { projectId: "vai-clisbot", sourceDirectory: "/work/vai-clisbot", name: "vai-clisbot" },
  workspace: { serverId: "uat-ai-team", workspaceId: "w1" },
};

function liveProject(serverId: string, projectId: string): HostProjectListItem {
  return {
    viewKey: createProjectViewKey({ kind: "placement", serverId, projectId }),
    projectKey: "remote:vai",
    projectName: projectId,
    projectKind: "git",
    iconWorkingDir: `/work/${projectId}`,
    hosts: [
      { serverId, projectId, iconWorkingDir: `/work/${projectId}`, worktreeSupport: "supported" },
    ],
    workspaceKeys: [`${serverId}:w1`],
  };
}

describe("remembered start store", () => {
  it("restores the stored start on hydrate", async () => {
    const { storage, release } = memoryStorage(JSON.stringify(VAI));
    const store = createRememberedStartStore(storage);
    const hydrated = store.hydrate();
    release();
    await hydrated;
    expect(store.isHydrated()).toBe(true);
    expect(store.get()).toEqual(VAI);
  });

  it("drops an unreadable stored start", async () => {
    const memory = memoryStorage('{"serverId":""}');
    const store = createRememberedStartStore(memory.storage);
    const hydrated = store.hydrate();
    memory.release();
    await hydrated;
    expect(store.get()).toBeNull();
    expect(memory.current()).toBeNull();
  });

  it("keeps a choice made before the stored one finished loading", async () => {
    const older = { ...VAI, serverId: "uat-head", workspace: null, project: null };
    const memory = memoryStorage(JSON.stringify(older));
    const store = createRememberedStartStore(memory.storage);
    const hydrated = store.hydrate();
    store.remember(VAI);
    memory.release();
    await hydrated;
    expect(store.get()).toEqual(VAI);
    expect(JSON.parse(memory.current() ?? "null")).toEqual(VAI);
  });
});

describe("isRememberedProjectGone", () => {
  const start = resolveRememberedStart({
    stored: VAI,
    lastWorkspace: VAI.workspace,
    liveProject: null,
  });

  it("keeps the project until its Host is online with its workspaces loaded", () => {
    for (const host of [
      { online: false, hydrated: true },
      { online: true, hydrated: false },
    ]) {
      expect(isRememberedProjectGone({ start, projects: [], ...host })).toBe(false);
    }
  });

  it("is gone only when the loaded Host no longer lists it", () => {
    const listed = [liveProject("uat-ai-team", "vai-clisbot")];
    const host = { online: true, hydrated: true };
    expect(isRememberedProjectGone({ start, projects: listed, ...host })).toBe(false);
    expect(isRememberedProjectGone({ start, projects: [], ...host })).toBe(true);
  });
});

describe("resolveRememberedStart", () => {
  it("restores the stored project before its Host has loaded the workspace", () => {
    const start = resolveRememberedStart({
      stored: VAI,
      lastWorkspace: VAI.workspace,
      liveProject: null,
    });
    expect(start?.serverId).toBe("uat-ai-team");
    expect(start?.project?.viewKey).toBe(liveProject("uat-ai-team", "vai-clisbot").viewKey);
    expect(start?.project?.projectName).toBe("vai-clisbot");
    expect(start?.project?.hosts[0]?.iconWorkingDir).toBe("/work/vai-clisbot");
  });

  it("prefers the loaded project when it is the stored one", () => {
    const live = liveProject("uat-ai-team", "vai-clisbot");
    expect(
      resolveRememberedStart({ stored: VAI, lastWorkspace: VAI.workspace, liveProject: live }),
    ).toEqual({ serverId: "uat-ai-team", project: live });
  });

  it("follows a workspace opened after the start was stored", () => {
    const opened = { serverId: "uat-hr", workspaceId: "w9" };
    expect(
      resolveRememberedStart({ stored: VAI, lastWorkspace: opened, liveProject: null }),
    ).toEqual({ serverId: "uat-hr", project: null });
  });

  it("remembers only the Host when no project was chosen", () => {
    const hostOnly = { ...VAI, project: null };
    expect(
      resolveRememberedStart({ stored: hostOnly, lastWorkspace: VAI.workspace, liveProject: null }),
    ).toEqual({ serverId: "uat-ai-team", project: null });
  });

  it("has nothing to restore on a first launch", () => {
    expect(resolveRememberedStart({ stored: null, lastWorkspace: null, liveProject: null })).toBe(
      null,
    );
  });
});
