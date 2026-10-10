import { useState, useCallback } from "react";
import type { QuickStartView } from "@clisbot/protocol/quick-starts/types";
import type { useQuickStarts } from "./use-quick-starts";
import type { QuickStartAction } from "./row";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useFormLifetime } from "@/clisbot/bots/create/use-form-lifetime";
type Source = ReturnType<typeof useQuickStarts>;
export function useQuickStartMutation(refetch: Source["refetch"]) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (
      task: () => Promise<{ error: string | null; errorCode?: string }>,
      after: () => void,
      failed?: (code?: string) => void,
    ) => {
      setBusy(true);
      setError(null);
      try {
        const response = await task();
        if (response.error) {
          failed?.(response.errorCode);
          await refetch();
          throw new Error(response.error);
        }
        await refetch();
        after();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [refetch],
  );
  return { busy, error, setError, run };
}
export function useQuickStartAction({
  source,
  menu,
  run,
  startEdit,
  closeMenu,
}: {
  source: Source;
  menu: QuickStartView | null;
  run: ReturnType<typeof useQuickStartMutation>["run"];
  startEdit: (item: QuickStartView, duplicate: boolean) => void;
  closeMenu: () => void;
}) {
  const active = useFormLifetime();
  const preferences = source.data?.preferences;
  const pins = preferences?.pinnedIds ?? EMPTY_IDS;
  return useCallback(
    async (selected: QuickStartAction, selectedItem?: QuickStartView) => {
      const item = selectedItem ?? menu;
      if (!item) return;
      if (selected === "duplicate" || selected === "edit") {
        startEdit(item, selected === "duplicate");
        return;
      }
      const client = source.client;
      if (!client) return;
      if (selected === "pin" || selected === "first") {
        let ids = pins.filter((id) => id !== item.id);
        if (selected === "first") ids = [item.id, ...ids];
        else if (!pins.includes(item.id)) ids.push(item.id);
        void run(
          () =>
            client.setQuickStartPins({
              pinnedIds: ids,
              expectedRevision: preferences?.revision ?? 0,
            }),
          closeMenu,
        );
      } else if (selected === "share") {
        void run(
          () =>
            client.saveQuickStart({
              id: item.id,
              expectedRevision: item.revision,
              input: {
                ...item,
                visibility: item.visibility === "host" ? "personal" : "host",
              },
            }),
          closeMenu,
        );
      } else if (selected === "delete") {
        const approved = await confirmRemoval(item);
        if (!approved || !active()) return;
        void run(
          () =>
            client.deleteQuickStart({
              id: item.id,
              expectedRevision: item.revision,
            }),
          closeMenu,
        );
      }
    },
    [menu, pins, preferences?.revision, source.client, run, startEdit, closeMenu, active],
  );
}
const EMPTY_IDS: string[] = [];

function confirmRemoval(item: QuickStartView) {
  return confirmDialog({
    title: "Delete quick start?",
    message: `“${item.name}” will be removed${
      item.visibility === "host" ? " for everyone on this Host" : ""
    }.`,
    confirmLabel: "Delete",
    destructive: true,
  });
}
