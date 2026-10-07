import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  CONNECTORS_OFF_LABEL,
  formatConnectorsOff,
  readConnectorsOff,
} from "@clisbot/protocol/connectors/types";
import { useSessionStore } from "@/stores/session-store";

/**
 * The Connectors one agent session leaves off (docs/features/connectors/README.md, "Per
 * session"). A running session keeps the list in its `clisbot.connectors-off` label, which the
 * relay reads on every call. A draft keeps it here, per draft, until its agent is created.
 */

const drafts = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();
const NONE: ReadonlySet<string> = new Set();

function draftStoreKey(serverId: string, draftKey: string): string {
  return `${serverId}\u0000${draftKey}`;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setDraft(key: string, off: ReadonlySet<string>): void {
  if (off.size === 0) drafts.delete(key);
  else drafts.set(key, off);
  for (const listener of listeners) listener();
}

/** The label a draft's new agent starts with; the list stays until `finishDraftConnectors`. */
export function draftConnectorsLabels(
  serverId: string,
  draftKey: string,
): Record<string, string> | undefined {
  const off = drafts.get(draftStoreKey(serverId, draftKey));
  return off ? { [CONNECTORS_OFF_LABEL]: formatConnectorsOff(off) } : undefined;
}

/**
 * Hands a draft's list to the agent made from it and forgets it. `sent` is the label the create
 * carried; a switch flipped while the create was on its way is written to the agent here.
 */
export async function finishDraftConnectors(input: {
  serverId: string;
  draftKey: string;
  agentId: string;
  sent: Record<string, string> | undefined;
}): Promise<void> {
  const now = draftConnectorsLabels(input.serverId, input.draftKey);
  setDraft(draftStoreKey(input.serverId, input.draftKey), NONE);
  const sent = input.sent?.[CONNECTORS_OFF_LABEL] ?? "";
  const wanted = now?.[CONNECTORS_OFF_LABEL] ?? "";
  if (sent === wanted) return;
  const client = useSessionStore.getState().sessions[input.serverId]?.client;
  // The agent exists either way; a failed write leaves the list it was created with.
  await client
    ?.updateAgent(input.agentId, { labels: { [CONNECTORS_OFF_LABEL]: wanted } })
    .catch(() => undefined);
}

/** A change to the off list: the next list from the current one. */
export type SessionOffEdit = (off: ReadonlySet<string>) => ReadonlySet<string>;

/**
 * A set of tools the session takes from as a whole (`wholeKey`: a tool group, an app, a server) or
 * one by one (`keyOf`). `given` is what the Project gives.
 */
export interface SessionToolSet {
  wholeKey: string;
  keyOf(tool: string): string;
  given: readonly string[];
}

/** The tools of the set this session keeps on. */
export function sessionKeptTools(set: SessionToolSet, off: ReadonlySet<string>): string[] {
  if (off.has(set.wholeKey)) return [];
  return set.given.filter((tool) => !off.has(set.keyOf(tool)));
}

/**
 * The off list with exactly `enabled` of the set on: none is the whole key, some is one key per
 * given tool left off. Other keys stay as they are.
 */
export function setSessionKeptTools(
  off: ReadonlySet<string>,
  set: SessionToolSet,
  enabled: readonly string[],
): Set<string> {
  const mine = new Set([set.wholeKey, ...set.given.map((tool) => set.keyOf(tool))]);
  const next = new Set([...off].filter((key) => !mine.has(key)));
  if (enabled.length === 0) return next.add(set.wholeKey);
  for (const tool of set.given) {
    if (!enabled.includes(tool)) next.add(set.keyOf(tool));
  }
  return next;
}

export function toggled(off: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(off);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function useDraftOff(serverId: string, draftKey: string | null) {
  const key = draftKey === null ? null : draftStoreKey(serverId, draftKey);
  const off = useSyncExternalStore(
    subscribe,
    () => (key === null ? NONE : (drafts.get(key) ?? NONE)),
    () => NONE,
  );
  const update = useCallback(
    async (edit: SessionOffEdit) => {
      if (key !== null) setDraft(key, edit(drafts.get(key) ?? NONE));
    },
    [key],
  );
  return { off, update };
}

async function afterPrevious(previous: Promise<void>, run: () => Promise<void>): Promise<void> {
  await previous;
  await run();
}

/**
 * A list the Host holds, switched here: a switch shows at once and writes in order, each write
 * carrying the switches before it. The shown list gives way once the Host holds the same one (or
 * the list belongs to another owner). When a write fails, the ones queued after it are dropped
 * and the switches show what the Host holds, so a failed switch never lands through a later one.
 */
export function useHostedOffList(input: {
  stored: ReadonlySet<string>;
  /** The agent or Chat the list belongs to; a new one starts from what the Host holds. */
  owner: string | null;
  write(next: ReadonlySet<string>): Promise<void>;
}) {
  const { stored, owner, write } = input;
  const [shown, setShown] = useState<{ owner: string | null; off: ReadonlySet<string> } | null>(
    null,
  );
  const current = shown && shown.owner === owner ? shown.off : null;
  useEffect(() => {
    if (current && formatConnectorsOff(current) === formatConnectorsOff(stored)) setShown(null);
  }, [current, stored]);
  const off = current ?? stored;
  const latest = useRef(off);
  latest.current = off;
  const writes = useRef({ chain: Promise.resolve(), generation: 0 });
  const update = useCallback(
    async (edit: SessionOffEdit) => {
      if (!owner) throw new Error("This Host is not connected.");
      const next = edit(latest.current);
      latest.current = next;
      setShown({ owner, off: next });
      const queue = writes.current;
      const generation = queue.generation;
      const run = afterPrevious(queue.chain, async () => {
        if (generation === queue.generation) await write(next);
      });
      queue.chain = run.catch(() => undefined);
      try {
        await run;
      } catch (error) {
        if (generation !== queue.generation) return;
        queue.generation += 1;
        setShown(null);
        throw error;
      }
    },
    [owner, write],
  );
  return { off, update };
}

/** A running session's list, in its label. */
function useRunningOff(serverId: string, agentId: string | null) {
  const label = useSessionStore((state) =>
    agentId
      ? state.sessions[serverId]?.agents?.get(agentId)?.labels?.[CONNECTORS_OFF_LABEL]
      : undefined,
  );
  const stored = useMemo(() => readConnectorsOff({ [CONNECTORS_OFF_LABEL]: label }), [label]);
  const write = useCallback(
    async (next: ReadonlySet<string>) => {
      const client = useSessionStore.getState().sessions[serverId]?.client;
      if (!agentId || !client) throw new Error("This Host is not connected.");
      await client.updateAgent(agentId, {
        labels: { [CONNECTORS_OFF_LABEL]: formatConnectorsOff(next) },
      });
    },
    [agentId, serverId],
  );
  return useHostedOffList({ stored, owner: agentId, write });
}

/** The session's off list and its edit: a running agent's, or a draft's before it starts. */
export function useSessionConnectorsOff(input: {
  serverId: string;
  agentId: string | null;
  draftKey: string | null;
}) {
  const draft = useDraftOff(input.serverId, input.agentId === null ? input.draftKey : null);
  const running = useRunningOff(input.serverId, input.agentId);
  return input.agentId === null ? draft : running;
}
