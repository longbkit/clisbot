import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";

const ENTRIES_PER_PAGE = 20;
const TEXT_PAGE_SIZE = 4096;
function readPath(root: unknown, path: readonly string[]): unknown {
  let value = root;
  for (const key of path)
    value =
      value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return value;
}
function entriesPage(value: object, offset: number): { keys: string[]; more: boolean } {
  const keys: string[] = [];
  let index = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (index++ < offset) continue;
    if (keys.length === ENTRIES_PER_PAGE) return { keys, more: true };
    keys.push(key);
  }
  return { keys, more: false };
}
function textBoundary(text: string, offset: number): number {
  if (
    offset > 0 &&
    offset < text.length &&
    text.charCodeAt(offset) >= 0xdc00 &&
    text.charCodeAt(offset) <= 0xdfff
  )
    return offset - 1;
  return offset;
}
function preview(value: unknown): string {
  if (typeof value === "string")
    return value.length > 80 ? `${value.slice(0, textBoundary(value, 80))}…` : value;
  if (Array.isArray(value)) return `[${value.length} values]`;
  if (value !== null && typeof value === "object") return "Object";
  return String(value);
}

function SnapshotEntry({
  label,
  value,
  open,
}: {
  label: string;
  value: unknown;
  open: (key: string) => void;
}) {
  const onPress = useCallback(() => open(label), [label, open]);
  return (
    <Button
      variant="ghost"
      size="sm"
      onPress={onPress}
    >{`${preview(label)}: ${preview(value)}`}</Button>
  );
}

/** Browses the existing snapshot without materializing a second giant JSON string. */
export function PermissionSnapshotInspector({ value: root }: { value: unknown }) {
  const [path, setPath] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const value = readPath(root, path);
  const object = value !== null && typeof value === "object" ? value : null;
  const page = useMemo(() => (object ? entriesPage(object, offset) : null), [object, offset]);
  const text = typeof value === "string" ? value : preview(value);
  const open = useCallback((key: string) => {
    setPath((current) => [...current, key]);
    setOffset(0);
  }, []);
  const back = useCallback(() => {
    setPath((current) => current.slice(0, -1));
    setOffset(0);
  }, []);
  const previous = useCallback(
    () =>
      setOffset((current) => Math.max(0, current - (object ? ENTRIES_PER_PAGE : TEXT_PAGE_SIZE))),
    [object],
  );
  const next = useCallback(
    () => setOffset((current) => current + (object ? ENTRIES_PER_PAGE : TEXT_PAGE_SIZE)),
    [object],
  );
  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        {path.length ? path.slice(-4).map(preview).join(" / ") : "Request and response snapshot"}
      </Text>
      {path.length ? (
        <Button variant="ghost" size="sm" onPress={back}>
          Back
        </Button>
      ) : null}
      {object && page ? (
        page.keys.map((key) => (
          <SnapshotEntry
            key={key}
            label={key}
            value={(object as Record<string, unknown>)[key]}
            open={open}
          />
        ))
      ) : (
        <Text selectable style={styles.text}>
          {text.slice(textBoundary(text, offset), textBoundary(text, offset + TEXT_PAGE_SIZE))}
        </Text>
      )}
      <View style={styles.navigation}>
        {offset > 0 ? (
          <Button variant="ghost" size="sm" onPress={previous}>
            Previous page
          </Button>
        ) : null}
        {(page?.more ?? offset + TEXT_PAGE_SIZE < text.length) ? (
          <Button variant="ghost" size="sm" onPress={next}>
            Next page
          </Button>
        ) : null}
      </View>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  container: { gap: theme.spacing[1], padding: theme.spacing[2] },
  navigation: { flexDirection: "row", gap: theme.spacing[1] },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
