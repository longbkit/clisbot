import { useMemo } from "react";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import type { QuickStartInput } from "@clisbot/protocol/quick-starts/types";
import type { QuickStartDestination } from "./model";
import type { useQuickStarts } from "./use-quick-starts";
import type { QuickStartLibrary } from "./use-library";
import { LibraryBody } from "./library";
export function QuickStartWindow({
  source,
  library,
  destinations,
  serverId,
}: {
  source: ReturnType<typeof useQuickStarts>;
  library: QuickStartLibrary;
  destinations: QuickStartDestination[];
  serverId: string;
  snapshot: () => QuickStartInput | null;
  compact: boolean;
}) {
  const { open, edit, busy, close, save } = library;
  let title = "Quick starts";
  if (edit) title = edit.revision ? "Edit quick start" : "New quick start";
  const header = useMemo(
    () => ({
      title,
      back: edit ? { onPress: close } : undefined,
      actions: edit ? (
        <Button
          variant="default"
          size="sm"
          onPress={save}
          disabled={busy || !source.online || !edit.canSave}
        >
          {busy ? "Saving..." : "Save"}
        </Button>
      ) : undefined,
    }),
    [edit, title, close, save, busy, source.online],
  );
  return (
    <AdaptiveModalSheet
      visible={open}
      onClose={close}
      header={header}
      desktopMaxWidth={640}
      compactPresentation="page"
    >
      <LibraryBody
        source={source}
        library={library}
        destinations={destinations}
        serverId={serverId}
      />
    </AdaptiveModalSheet>
  );
}
