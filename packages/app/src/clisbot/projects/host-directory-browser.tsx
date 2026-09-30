import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { Folder, ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

const ThemedFolder = withUnistyles(Folder);
const ThemedChevronRight = withUnistyles(ChevronRight);

/** Only mounted behind server_info.features.projectDirectoryBrowse. */
export function HostDirectoryBrowser({
  serverId,
  hostLabel,
  initialPath,
  onPathChange,
  busy,
  error,
  selectLabel,
  selectsParent,
  onSelect,
}: {
  serverId: string;
  hostLabel: string;
  initialPath: string;
  onPathChange(path: string): void;
  busy: boolean;
  error: string | null;
  selectLabel: string;
  selectsParent: boolean;
  onSelect(path: string): void;
}) {
  const client = useHostRuntimeClient(serverId);
  const [path, setPath] = useState(initialPath);
  const [draft, setDraft] = useState(initialPath);
  const [filter, setFilter] = useState("");
  const result = useFetchQuery({
    queryKey: ["clisbot", "project-directory-browser", serverId, path, filter],
    queryFn: async () => {
      if (!client) throw new Error("Host is disconnected");
      const payload = await client.getDirectorySuggestions({
        browsePath: path,
        query: filter,
        includeDirectories: true,
        includeFiles: false,
        limit: 100,
      });
      if (payload.error) throw new Error(payload.error);
      if (!payload.directory) throw new Error("Update the Host to browse folders");
      return payload;
    },
    dataShape: "value",
    enabled: Boolean(client),
    retry: false,
    staleTimeMs: 0,
  });
  const directory = result.data?.directory;
  const selectable = directory && (selectsParent || directory.canSelect);
  const navigate = useCallback(
    (target: string) => {
      setPath(target);
      onPathChange(target);
      setDraft(target);
      setFilter("");
    },
    [onPathChange],
  );
  const go = useCallback(() => navigate(draft), [draft, navigate]);
  const home = useCallback(() => navigate("~"), [navigate]);
  const up = useCallback(() => {
    if (directory?.parentPath) navigate(directory.parentPath);
  }, [directory, navigate]);
  const select = useCallback(() => {
    if (selectable) onSelect(directory.path);
  }, [directory, onSelect, selectable]);
  const retry = useCallback(() => void result.refetch(), [result]);
  const disabled = busy || result.isFetching || !client;
  return (
    <View style={styles.container} testID="host-directory-browser">
      <Text style={settingsStyles.rowHint}>
        Choose a folder on {hostLabel} for your documents or code.
      </Text>
      <View style={styles.actions}>
        <Button size="sm" variant="outline" disabled={busy} onPress={home}>
          Home folder
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !directory?.parentPath}
          onPress={up}
        >
          Up one level
        </Button>
      </View>
      <View style={styles.pathRow}>
        <View style={styles.pathInput}>
          <FormTextInput
            key={path}
            initialValue={draft}
            onChangeText={setDraft}
            onSubmitEditing={go}
            accessibilityLabel="Host folder path"
            placeholder="Absolute path on this Host"
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <Button variant="outline" disabled={busy || !draft.trim()} onPress={go}>
          Go
        </Button>
      </View>
      {directory ? (
        <Text selectable style={settingsStyles.rowTitle}>
          {directory.path}
        </Text>
      ) : null}
      <FormTextInput
        key={`filter-${path}`}
        initialValue=""
        onChangeText={setFilter}
        accessibilityLabel="Filter folders"
        placeholder="Filter folders by name"
        editable={!busy}
      />
      {result.isFetching ? <Text style={settingsStyles.rowHint}>Loading folders…</Text> : null}
      {result.error ? (
        <View>
          <Text accessibilityRole="alert">{String(result.error)}</Text>
          <Button variant="outline" onPress={retry}>
            Retry
          </Button>
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      <DirectoryEntries
        entries={result.data?.entries}
        loading={result.isFetching}
        failed={result.isError}
        filter={filter}
        busy={busy}
        onOpen={navigate}
      />
      {directory?.truncated ? (
        <Text style={settingsStyles.rowHint}>
          Showing the first 100 folders. Filter by name to find more.
        </Text>
      ) : null}
      {directory && !selectable ? (
        <Text style={settingsStyles.rowHint}>
          Choose a subfolder allowed by this Host’s Project policy.
        </Text>
      ) : null}
      <Button disabled={disabled || !selectable} loading={busy} onPress={select}>
        {selectLabel}
      </Button>
    </View>
  );
}

function DirectoryEntries({
  entries,
  loading,
  failed,
  filter,
  busy,
  onOpen,
}: {
  entries: { path: string }[] | undefined;
  loading: boolean;
  failed: boolean;
  filter: string;
  busy: boolean;
  onOpen(path: string): void;
}) {
  return (
    <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
      {!loading && !failed
        ? entries?.map((entry) => (
            <DirectoryRow key={entry.path} path={entry.path} disabled={busy} onOpen={onOpen} />
          ))
        : null}
      {!loading && !failed && entries?.length === 0 ? (
        <Text style={settingsStyles.rowHint}>
          No visible subfolders{filter ? " matching this name" : ""}.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function DirectoryRow({
  path,
  disabled,
  onOpen,
}: {
  path: string;
  disabled: boolean;
  onOpen(path: string): void;
}) {
  const open = useCallback(() => onOpen(path), [onOpen, path]);
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.directoryRow,
      (hovered || pressed) && styles.highlighted,
    ],
    [],
  );
  return (
    <Pressable
      onPress={open}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Open folder ${path.split(/[\\/]/).pop()}`}
      style={rowStyle}
    >
      <ThemedFolder size={18} uniProps={mutedIconColorMapping} />
      <Text numberOfLines={1} style={styles.directoryName}>
        {path.split(/[\\/]/).pop()}
      </Text>
      <ThemedChevronRight size={16} uniProps={mutedIconColorMapping} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { padding: theme.spacing[4], gap: theme.spacing[3], flexShrink: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  pathRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  pathInput: { flex: 1, minWidth: 0 },
  directoryRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: theme.spacing[3],
    gap: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
  },
  directoryName: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.base },
  highlighted: { backgroundColor: theme.colors.interactionHighlight },
  list: { maxHeight: 240, flexShrink: 1 },
}));
