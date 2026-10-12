import { useState, useCallback, useSyncExternalStore, useEffect } from "react";
import { randomUUID } from "expo-crypto";
import type { QuickStartInput, QuickStartView } from "@clisbot/protocol/quick-starts/types";
import { useFormLifetime } from "@/clisbot/bots/create/use-form-lifetime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { findDestination, type QuickStartEdit, type QuickStartDestination } from "./model";
import { openQuickStartForm, type QuickStartForm } from "./form-model";
const subscribeEmpty = () => () => {};
const empty = () => null;
export function useQuickStartEditor(
  snapshot: () => QuickStartInput | null,
  show: () => void,
  setError: (message: string | null) => void,
  destinations: QuickStartDestination[],
) {
  const active = useFormLifetime();
  const [form, setForm] = useState<QuickStartForm | null>(null);
  const [editing, setEditing] = useState(false);
  const state = useSyncExternalStore(form?.subscribe ?? subscribeEmpty, form?.getState ?? empty);
  const [picker, setPicker] = useState<string | null>(null);
  const setTargetOpen = useCallback((open: boolean) => setPicker(open ? "destination" : null), []);
  const targetOpen = picker === "destination";
  useEffect(() => () => form?.close(), [form]);
  const setEdit = useCallback(
    (next: QuickStartEdit | null) => {
      if (next)
        setForm(
          openQuickStartForm(
            next,
            findDestination(destinations, next.input.target)?.option ?? null,
          ),
        );
      setEditing(!!next);
    },
    [destinations],
  );
  const startEdit = useCallback(
    async (item?: QuickStartView, duplicate = false) => {
      // With nothing chosen in the composer yet, start from the first place to chat; the form
      // lets the user change it.
      const input = item ?? snapshot() ?? blankQuickStart(destinations);
      if (!input) {
        setError("Add a project or a bot on this Host first.");
        return;
      }
      if (state?.dirty && !(await confirmDraftReplacement())) return;
      if (!active()) return;
      setTargetOpen(false);
      setEdit(editSeed(input, item, duplicate));
      setError(null);
      show();
    },
    [snapshot, destinations, state?.dirty, show, setError, setEdit, setTargetOpen, active],
  );
  const change = useCallback((input: QuickStartInput) => form?.change(input), [form]);
  const resume = useCallback(() => {
    setEditing(true);
    show();
  }, [show]);
  const finish = useCallback(() => {
    setForm(null);
    setEditing(false);
  }, []);
  return {
    form,
    edit: editing ? state : null,
    draft: !editing ? state : null,
    setEdit,
    startEdit,
    change,
    resume,
    finish,
    picker,
    setPicker,
    targetOpen,
    setTargetOpen,
  };
}
export function newQuickStartId() {
  return `qs_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function editSeed(
  input: QuickStartInput,
  item: QuickStartView | undefined,
  duplicate: boolean,
): QuickStartEdit {
  return {
    id: item && !duplicate ? item.id : newQuickStartId(),
    revision: item && !duplicate ? item.revision : 0,
    input: {
      name: duplicate ? `${input.name} copy` : input.name,
      visibility: duplicate ? "personal" : input.visibility,
      target: input.target,
      startingPrompt: input.startingPrompt,
      agent: input.agent,
    },
  };
}

function confirmDraftReplacement() {
  return confirmDialog({
    title: "Replace draft?",
    message: "Your unsaved quick start will be replaced.",
    confirmLabel: "Replace draft",
    destructive: true,
  });
}

function blankQuickStart(destinations: QuickStartDestination[]): QuickStartInput | null {
  const first = destinations[0];
  return first
    ? {
        name: "",
        visibility: "personal",
        target: first.target,
        startingPrompt: "",
        agent: { kind: "default" },
      }
    : null;
}
