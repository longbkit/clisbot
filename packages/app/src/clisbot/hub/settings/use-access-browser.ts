import { useCallback, useMemo, useState } from "react";
import { accessEntries, type AccessEntry } from "./access-browser-model";
import type { GrantDirectory, GrantGrouping, GrantRow } from "./access-grant-rows";

/** A subject or resource key (`kind\0id`) as the entry key it opens (`kind:id`). */
function entryKeyOf(targetKey: string | null): string | null {
  return targetKey === null ? null : targetKey.replace("\0", ":");
}

/**
 * The Access screen's state: which view, which entry is open, and what the grant
 * sheet opens on. A link for one person or resource opens on that entry.
 */
export function useAccessBrowser({
  initialSubject,
  initialResource,
  rows,
  directory,
  edit,
}: {
  initialSubject: string | null;
  initialResource: string | null;
  rows: readonly GrantRow[];
  directory: GrantDirectory;
  edit(assignment: null): void;
}) {
  const [grouping, setGrouping] = useState<GrantGrouping>(
    initialResource === null ? "subject" : "resource",
  );
  const [selectedKey, setSelectedKey] = useState(() =>
    entryKeyOf(initialResource ?? initialSubject),
  );
  const [prefill, setPrefill] = useState<AccessEntry["target"]>({
    subject: initialSubject,
    resource: initialResource,
  });
  const entries = useMemo(
    () => accessEntries(rows, grouping, directory),
    [directory, grouping, rows],
  );
  const changeGrouping = useCallback((next: GrantGrouping) => {
    setGrouping(next);
    setSelectedKey(null);
  }, []);
  const grantTo = useCallback(
    (entry: AccessEntry) => {
      setPrefill(entry.target);
      edit(null);
    },
    [edit],
  );
  return { grouping, changeGrouping, selectedKey, setSelectedKey, entries, prefill, grantTo };
}
