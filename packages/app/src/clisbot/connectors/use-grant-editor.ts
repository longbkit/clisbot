import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectorGrant } from "@clisbot/protocol/connectors/types";
import { toErrorMessage } from "@/utils/error-messages";

/** One change to a Project's grant, applied to the latest copy. */
export type GrantEdit = (grant: ConnectorGrant | undefined) => ConnectorGrant;

/**
 * Local copy of a Project's grant. Every change shows at once and saves in order, each applied by
 * `onSave` to the Host's grant as it is then, so a change made elsewhere (a card's Allow, another
 * device) is kept. Once the last save is done the copy shows what the Host stored. When a save
 * fails, the saves queued after it are dropped and the copy returns to what the Host last held.
 */
export function useGrantEditor(
  saved: ConnectorGrant | undefined,
  onSave: (edit: GrantEdit) => Promise<ConnectorGrant | null>,
) {
  const [grant, setGrant] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(saved);
  const confirmed = useRef(saved);
  const saving = useRef({ pending: 0, generation: 0, queue: Promise.resolve() });
  const show = useCallback((next: ConnectorGrant | undefined) => {
    latest.current = next;
    setGrant(next);
  }, []);
  useEffect(() => {
    confirmed.current = saved;
    if (saving.current.pending === 0) show(saved);
  }, [saved, show]);
  const save = useCallback(
    async (generation: number, edit: GrantEdit) => {
      const state = saving.current;
      if (generation !== state.generation) return;
      try {
        const stored = (await onSave(edit)) ?? undefined;
        confirmed.current = stored;
        // Later edits still queued show on top of this one until their own saves end.
        if (generation === state.generation && state.pending === 1) show(stored);
      } catch (cause) {
        if (generation !== state.generation) return;
        state.generation += 1;
        show(confirmed.current);
        setError(toErrorMessage(cause));
      }
    },
    [onSave, show],
  );
  const apply = useCallback(
    (edit: GrantEdit) => {
      show(edit(latest.current));
      setError(null);
      const state = saving.current;
      const generation = state.generation;
      state.pending += 1;
      state.queue = state.queue
        .then(() => save(generation, edit))
        .finally(() => {
          state.pending -= 1;
        });
    },
    [save, show],
  );
  return { grant, error, apply };
}
