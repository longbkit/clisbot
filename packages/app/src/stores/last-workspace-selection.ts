import { z } from "zod";

export interface ActiveWorkspaceSelection {
  serverId: string;
  workspaceId: string;
}

export const LAST_WORKSPACE_SELECTION_STORAGE_KEY = "clisbot:last-workspace-route-selection";

export interface LastWorkspaceSelectionStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}

const ActiveWorkspaceSelectionSchema: z.ZodType<ActiveWorkspaceSelection> = z.strictObject({
  serverId: z.string().trim().min(1),
  workspaceId: z.string().trim().min(1),
});

function normalizeWorkspaceSelection(input: unknown): ActiveWorkspaceSelection | null {
  const result = ActiveWorkspaceSelectionSchema.safeParse(input);
  return result.success ? result.data : null;
}

function parseStoredWorkspaceSelection(stored: string | null): ActiveWorkspaceSelection | null {
  if (!stored) {
    return null;
  }
  try {
    return normalizeWorkspaceSelection(JSON.parse(stored));
  } catch {
    return null;
  }
}

function selectionKey(selection: ActiveWorkspaceSelection): string {
  return JSON.stringify([selection.serverId, selection.workspaceId]);
}

export function createLastWorkspaceSelectionStore(storage: LastWorkspaceSelectionStorage) {
  let selection: ActiveWorkspaceSelection | null = null;
  let hydrated = false;
  let hydrationPromise: Promise<void> | null = null;
  let revision = 0;
  // A workspace its connected Host proved missing. Visiting its stale URL must not remember it
  // again, or every launch restores the dead workspace.
  let forgottenKey: string | null = null;
  const listeners = new Set<() => void>();

  function notifyListeners() {
    for (const listener of listeners) {
      listener();
    }
  }

  function remember(next: ActiveWorkspaceSelection) {
    const normalized = normalizeWorkspaceSelection(next);
    if (!normalized || selectionKey(normalized) === forgottenKey) {
      return;
    }
    forgottenKey = null;
    if (
      selection?.serverId === normalized.serverId &&
      selection.workspaceId === normalized.workspaceId
    ) {
      return;
    }
    selection = normalized;
    revision += 1;
    notifyListeners();
    // workspaceId is opaque; do not parse this persisted selection back into a path.
    void storage.write(JSON.stringify(normalized)).catch(() => {});
  }

  /** Drop a selection whose workspace is gone, so startup stops restoring it. */
  function forget(missing: ActiveWorkspaceSelection) {
    forgottenKey = selectionKey(missing);
    if (selection === null || selectionKey(selection) !== forgottenKey) {
      return;
    }
    selection = null;
    revision += 1;
    notifyListeners();
    void storage.clear().catch(() => {});
  }

  function hydrate(): Promise<void> {
    if (hydrationPromise) {
      return hydrationPromise;
    }
    const hydrationRevision = revision;
    hydrationPromise = storage
      .read()
      .then((stored) => {
        if (revision === hydrationRevision) {
          selection = parseStoredWorkspaceSelection(stored);
          if (selection !== null && selectionKey(selection) === forgottenKey) {
            selection = null;
          }
          if (stored !== null && selection === null) {
            void storage.clear().catch(() => {});
          }
        }
        return undefined;
      })
      .catch(() => {
        if (revision === hydrationRevision) {
          selection = null;
        }
      })
      .finally(() => {
        hydrated = true;
        notifyListeners();
      });
    return hydrationPromise;
  }

  return {
    getSelection: () => selection,
    hydrate,
    isHydrated: () => hydrated,
    forget,
    remember,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
