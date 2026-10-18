import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { TextReplacement } from "@/composer/types";
import type { ComposerInputMode } from "@/composer/input-mode";

export interface ComposerEditingHandoff {
  snapshot: { text: string; selection: { start: number; end: number } };
  focused: boolean;
  replacementKey: string;
}

export interface ComposerQueueEdit {
  targetKey: string;
  id: string;
  revision: number;
  original: string;
  stale: boolean;
}

/** Editing metadata outlives a layout's input; draft text still belongs to its draft owner. */
export class ComposerEditingSession {
  private fullscreen = false;
  private queueEdit: ComposerQueueEdit | null = null;
  getQueueEdit = () => this.queueEdit;
  setQueueEdit = (
    next:
      | ComposerQueueEdit
      | null
      | ((current: ComposerQueueEdit | null) => ComposerQueueEdit | null),
  ) => {
    this.queueAdmission = null;
    this.queueEdit = typeof next === "function" ? next(this.queueEdit) : next;
    for (const listener of this.listeners) listener();
  };
  private queueMutation: { token: symbol; editor: ComposerQueueEdit | null } | null = null;
  private queueAdmission: {
    editor: ComposerQueueEdit | null;
    fingerprint: string;
    id: string;
  } | null = null;
  getQueueMutationPending = () => this.queueMutation !== null;
  beginQueueMutation(editor: ComposerQueueEdit | null): symbol | null {
    if (this.queueMutation || this.queueEdit !== editor) return null;
    const token = Symbol("local queue editor mutation");
    this.queueMutation = { token, editor };
    for (const listener of this.listeners) listener();
    return token;
  }
  ownsQueueMutation(token: symbol): boolean {
    return this.queueMutation?.token === token && this.queueMutation.editor === this.queueEdit;
  }
  finishQueueMutation(token: symbol): void {
    if (this.queueMutation?.token !== token) return;
    this.queueMutation = null;
    for (const listener of this.listeners) listener();
  }
  queueAdmissionId(token: symbol, fingerprint: string, createId: () => string): string {
    if (!this.ownsQueueMutation(token)) throw new Error("Local queue editor changed");
    if (
      this.queueAdmission?.editor !== this.queueEdit ||
      this.queueAdmission.fingerprint !== fingerprint
    )
      this.queueAdmission = { editor: this.queueEdit, fingerprint, id: createId() };
    return this.queueAdmission.id;
  }
  private handoff: ComposerEditingHandoff | null = null;
  private listeners = new Set<() => void>();
  getFullscreen = () => this.fullscreen;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  changePresentation(fullscreen: boolean, handoff: ComposerEditingHandoff) {
    this.captureForRemount(handoff);
    if (fullscreen === this.fullscreen) return;
    this.fullscreen = fullscreen;
    for (const listener of this.listeners) listener();
  }
  captureForRemount(handoff: ComposerEditingHandoff) {
    this.handoff = handoff;
  }
  peekHandoff(replacement: TextReplacement): ComposerEditingHandoff | null {
    const handoff = this.handoff;
    if (!handoff || replacement.kind === "initial" || replacement.key === handoff.replacementKey)
      return handoff;
    // A replacement command issued since capture supersedes the old editor's live buffer.
    return {
      snapshot: {
        text: replacement.text,
        selection: { start: replacement.text.length, end: replacement.text.length },
      },
      focused: handoff.focused,
      replacementKey: replacement.key,
    };
  }
  takeHandoff(replacement: TextReplacement) {
    const handoff = this.peekHandoff(replacement);
    this.handoff = null;
    return handoff;
  }
}

class ComposerEditingSessions {
  private workspaces = new Map<
    string,
    Map<string, { targetKey: string; sessions: Map<ComposerInputMode, ComposerEditingSession> }>
  >();
  get(workspaceKey: string, tabId: string, targetKey: string, purpose: ComposerInputMode) {
    let workspace = this.workspaces.get(workspaceKey);
    if (!workspace) {
      workspace = new Map();
      this.workspaces.set(workspaceKey, workspace);
    }
    let tab = workspace.get(tabId);
    if (!tab || tab.targetKey !== targetKey) {
      tab = { targetKey, sessions: new Map() };
      workspace.set(tabId, tab);
    }
    let session = tab.sessions.get(purpose);
    if (!session) {
      session = new ComposerEditingSession();
      tab.sessions.set(purpose, session);
    }
    return session;
  }
  retain(workspaceKey: string, tabIds: readonly string[]) {
    const workspace = this.workspaces.get(workspaceKey);
    if (!workspace) return;
    const retained = new Set(tabIds);
    for (const tabId of workspace.keys()) if (!retained.has(tabId)) workspace.delete(tabId);
    if (workspace.size === 0) this.workspaces.delete(workspaceKey);
  }
}

const SessionsContext = createContext<ComposerEditingSessions | null>(null);
const WorkspaceContext = createContext<string | null>(null);
const ScopeContext = createContext<{ tabId: string; targetKey: string } | null>(null);

/** App-container ownership survives replacement of both the gesture shell and tab layout. */
export function ComposerEditingSessionsProvider({ children }: { children: ReactNode }) {
  const [sessions] = useState(() => new ComposerEditingSessions());
  return <SessionsContext.Provider value={sessions}>{children}</SessionsContext.Provider>;
}
export function WorkspaceComposerEditingSessionsProvider({
  workspaceKey,
  tabIds,
  children,
}: {
  workspaceKey: string;
  tabIds: readonly string[];
  children: ReactNode;
}) {
  const sessions = useContext(SessionsContext);
  useEffect(() => sessions?.retain(workspaceKey, tabIds), [sessions, workspaceKey, tabIds]);
  return <WorkspaceContext.Provider value={workspaceKey}>{children}</WorkspaceContext.Provider>;
}
export function ComposerEditingScope({
  tabId,
  targetKey,
  children,
}: {
  tabId: string;
  targetKey: string;
  children: ReactNode;
}) {
  const scope = useMemo(() => ({ tabId, targetKey }), [tabId, targetKey]);
  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}
export function useComposerEditingSession(
  purpose: ComposerInputMode,
  provided?: ComposerEditingSession,
): ComposerEditingSession {
  const sessions = useContext(SessionsContext);
  const scope = useContext(ScopeContext);
  const workspaceKey = useContext(WorkspaceContext);
  const [local] = useState(() => provided ?? new ComposerEditingSession());
  if (provided) return provided;
  return sessions && scope && workspaceKey
    ? sessions.get(workspaceKey, scope.tabId, scope.targetKey, purpose)
    : local;
}
export function useComposerFullscreen(session: ComposerEditingSession): boolean {
  return useSyncExternalStore(session.subscribe, session.getFullscreen, session.getFullscreen);
}

/** Memory-only metadata shares the existing layout/remount owner, never draft persistence. */
export function useComposerQueueEdit(session: ComposerEditingSession) {
  const edit = useSyncExternalStore(session.subscribe, session.getQueueEdit, session.getQueueEdit);
  return [edit, session.setQueueEdit] as const;
}

export function useComposerQueueMutationPending(session: ComposerEditingSession) {
  return useSyncExternalStore(
    session.subscribe,
    session.getQueueMutationPending,
    session.getQueueMutationPending,
  );
}
