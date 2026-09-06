export interface ProjectDirectoryState {
  projectId: string | null;
  rootPath: string | null;
  cwd: string;
  mode: "project" | "custom" | "preserve";
}

/** The Host owns Project paths; this model only owns the user's directory choice. */
export function openProjectDirectoryForm(input: { projectId: string | null; cwd: string }) {
  let state: ProjectDirectoryState = {
    ...input,
    rootPath: null,
    mode: input.cwd.length > 0 ? "preserve" : "project",
  };
  const listeners = new Set<() => void>();
  function publish(next: ProjectDirectoryState) {
    if (
      next.projectId === state.projectId &&
      next.rootPath === state.rootPath &&
      next.cwd === state.cwd &&
      next.mode === state.mode
    )
      return;
    state = next;
    for (const listener of listeners) listener();
  }
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    selectProject(projectId: string) {
      if (projectId === state.projectId) return;
      publish({ projectId, rootPath: null, cwd: "", mode: "project" });
    },
    applyRoot(projectId: string | null, rootPath: string | null) {
      if (projectId !== state.projectId) return;
      let mode = state.mode;
      if (mode === "preserve" && rootPath !== null) {
        mode = state.cwd === rootPath ? "project" : "custom";
      }
      publish({ ...state, rootPath, mode, cwd: mode === "project" ? (rootPath ?? "") : state.cwd });
    },
    setCustomDirectory(custom: boolean) {
      publish({
        ...state,
        mode: custom ? "custom" : "project",
        cwd: custom ? state.cwd : (state.rootPath ?? ""),
      });
    },
    setCwd(cwd: string) {
      publish({ ...state, cwd, mode: "custom" });
    },
  };
}
