import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Shortcut } from "@/components/ui/shortcut";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import { useFetchQuery } from "@/data/query";
import { moveAddProjectActiveIndex } from "@/add-project-flow/model";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import {
  browseErrorText,
  browseInputFor,
  childBrowseInput,
  exactBrowseEntry,
  parentBrowseInput,
  rankBrowseEntries,
  splitBrowseInput,
} from "./browse-path";
import { BrowseList, type BrowseRowItem } from "./host-directory-browser-list";

const ThemedTextInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.placeholder,
}));
/** Enter opens a folder; picking one always takes the modifier. */
export const SELECT_FOLDER_KEYS = ["mod", "Enter"];
const BROWSE_LIMIT = 100;
const FILTER_DEBOUNCE_MS = 120;

export type BrowserKeyHandler = (event: KeyboardEvent) => boolean;

export interface HostDirectoryBrowserProps {
  serverId: string;
  hostLabel: string;
  /** Sits left of the path input, e.g. the flow's Back button. */
  leading?: ReactNode;
  /** The path input to start from, e.g. `~/` or `/srv/app/`. */
  initialInput: string;
  onInputChange(input: string): void;
  busy: boolean;
  error: string | null;
  selectLabel: string;
  /** Picking a parent folder ignores the Host's Project policy for the folder itself. */
  selectsParent: boolean;
  onSelect(path: string): void;
  /** Web keys arrive through the modal's overlay registration, which owns Escape. */
  keyHandlerRef: MutableRefObject<BrowserKeyHandler | null>;
}

/**
 * One path input: Enter opens a folder (the highlighted one, or the path typed),
 * ⌘/Ctrl+Enter or the select button picks the folder the input names.
 * Only mounted behind server_info.features.projectDirectoryBrowse.
 */
export function HostDirectoryBrowser(props: HostDirectoryBrowserProps) {
  const input = useBrowseInput(props.initialInput, props.onInputChange);
  const listing = useBrowseListing(props.serverId, input.query, input.value);
  const actions = useBrowseActions(props, input, listing);
  const shortcut = useMemo(() => <Shortcut keys={SELECT_FOLDER_KEYS} labels="words" />, []);
  return (
    <View style={styles.container} testID="host-directory-browser">
      <View style={styles.inputRow}>
        {props.leading}
        <ThemedTextInput
          ref={input.ref}
          initialValue={input.value}
          onChangeText={input.change}
          onSubmitEditing={isWeb ? undefined : actions.openActive}
          onKeyPress={isWeb ? undefined : actions.handleNativeKeyPress}
          submitBehavior="submit"
          placeholder="~/"
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!props.busy}
          returnKeyType="go"
          accessibilityLabel="Folder path on Host"
          testID="host-directory-browser-input"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!actions.selectTarget}
          loading={props.busy}
          onPress={actions.select}
          trailing={shortcut}
          testID="host-directory-browser-select"
        >
          {props.selectLabel}
        </Button>
      </View>
      <BrowseList
        hostLabel={props.hostLabel}
        folderKey={listing.data?.folder.path}
        rows={actions.rows}
        activeIndex={actions.activeIndex}
        status={actions.status}
        error={props.error}
        notice={actions.notice}
        disabled={props.busy}
        onActivate={actions.activate}
      />
    </View>
  );
}

interface BrowseInputState {
  ref: RefObject<EditingTextInputHandle | null>;
  value: string;
  /** What the listing was asked for; trails `value` while the user types. */
  query: string;
  change(value: string): void;
  navigate(value: string): void;
}

function useBrowseInput(initialInput: string, onInputChange: (input: string) => void) {
  const ref = useRef<EditingTextInputHandle>(null);
  const [value, setValue] = useState(() => initialInput || "~/");
  const [query, setQuery] = useState(value);
  useEffect(() => {
    if (query === value) return;
    const timer = setTimeout(() => setQuery(value), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, value]);
  useEffect(() => {
    const timer = setTimeout(() => ref.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);
  const change = useCallback(
    (next: string) => {
      setValue(next);
      onInputChange(next);
    },
    [onInputChange],
  );
  const navigate = useCallback(
    (next: string) => {
      ref.current?.replaceText(next);
      setValue(next);
      setQuery(next);
      onInputChange(next);
    },
    [onInputChange],
  );
  return { ref, value, query, change, navigate } satisfies BrowseInputState;
}

type BrowseListing = ReturnType<typeof useBrowseListing>;

function useBrowseListing(serverId: string, query: string, value: string) {
  const client = useHostRuntimeClient(serverId);
  const target = splitBrowseInput(query);
  const result = useFetchQuery({
    queryKey: ["clisbot", "project-directory-browser", serverId, target.directory, target.filter],
    queryFn: async () => {
      if (!client) throw new Error("Host is disconnected");
      const payload = await client.getDirectorySuggestions({
        browsePath: target.directory,
        query: target.filter,
        includeDirectories: true,
        includeFiles: false,
        limit: BROWSE_LIMIT,
      });
      if (payload.error) throw new Error(payload.error);
      if (!payload.directory) throw new Error("Update the Host to browse folders");
      const entries = rankBrowseEntries(payload.entries ?? [], target.filter);
      return { input: target, folder: payload.directory, entries };
    },
    dataShape: "list",
    enabled: Boolean(client),
    retry: false,
    staleTimeMs: 0,
  });
  const current = splitBrowseInput(value);
  const data = result.data;
  const fresh =
    data !== undefined &&
    data.input.directory === current.directory &&
    data.input.filter === current.filter;
  const retry = useCallback(() => void result.refetch(), [result]);
  return {
    current,
    data,
    fresh,
    loading: data === undefined && result.isFetching,
    error: result.isError ? browseErrorText(result.error) : null,
    retry,
  };
}

function useBrowseActions(
  props: HostDirectoryBrowserProps,
  input: BrowseInputState,
  listing: BrowseListing,
) {
  const { data, fresh, current } = listing;
  const { navigate, value } = input;
  const parentInput = fresh && data ? parentBrowseInput(value, data.folder.parentPath) : null;
  const rows = useMemo<BrowseRowItem[]>(
    () => [
      ...(parentInput ? [{ kind: "parent" as const }] : []),
      ...(data?.entries ?? []).map((entry) => ({ kind: "folder" as const, path: entry.path })),
    ],
    [data, parentInput],
  );
  const activeIndex = useActiveIndex(data, rows);
  const go = useCallback(
    (next: string | null) => {
      if (!next || props.busy) return false;
      navigate(next);
      return true;
    },
    [navigate, props.busy],
  );
  const goUp = useCallback(() => go(parentInput), [go, parentInput]);
  const activate = useCallback(
    (row: BrowseRowItem) => {
      if (row.kind === "parent") goUp();
      else go(data ? childBrowseInput(data.input.directory, row.path) : null);
    },
    [data, go, goUp],
  );
  const openActive = useCallback(() => {
    const row = fresh ? rows[activeIndex.value] : undefined;
    if (row) activate(row);
    else if (current.filter) go(browseInputFor(value));
  }, [activate, activeIndex.value, current.filter, fresh, go, rows, value]);
  const selectTarget = selectTargetOf(listing, props.selectsParent);
  const select = useCallback(() => {
    if (selectTarget && !props.busy) props.onSelect(selectTarget);
  }, [props, selectTarget]);
  const keys = useBrowseKeys({ openActive, select, goUp, move: activeIndex.move });
  const { keyHandlerRef } = props;
  useEffect(() => {
    keyHandlerRef.current = keys.handleWebKey;
    return () => {
      keyHandlerRef.current = null;
    };
  }, [keyHandlerRef, keys.handleWebKey]);
  const status = {
    loading: listing.loading,
    error: listing.error,
    fresh,
    filter: current.filter,
    retry: listing.retry,
  };
  const notice = browseNotice(listing, props.selectsParent);
  return {
    rows,
    activeIndex: activeIndex.value,
    status,
    activate,
    openActive,
    select,
    selectTarget,
    notice,
    ...keys,
  };
}

/**
 * Each listing starts on its first folder rather than `..`, so Enter right after
 * opening a folder goes deeper instead of bouncing back up.
 */
function useActiveIndex(data: unknown, rows: BrowseRowItem[]) {
  const [moved, setMoved] = useState<{ data: unknown; index: number } | null>(null);
  const initial = rows[0]?.kind === "parent" && rows.length > 1 ? 1 : 0;
  const value = moved && moved.data === data ? Math.min(moved.index, rows.length - 1) : initial;
  const move = useCallback(
    (direction: "next" | "previous") =>
      setMoved({ data, index: moveAddProjectActiveIndex(value, rows.length, direction) }),
    [data, rows.length, value],
  );
  return { value: Math.max(value, 0), move };
}

/** The folder the input names: the listed folder, or the subfolder whose name was typed. */
function selectTargetOf(listing: BrowseListing, selectsParent: boolean): string | null {
  const { data, fresh, current } = listing;
  if (!fresh || !data) return null;
  if (current.filter) return exactBrowseEntry(data.entries, current.filter)?.path ?? null;
  return selectsParent || data.folder.canSelect ? data.folder.path : null;
}

function useBrowseKeys(input: {
  openActive(): void;
  select(): void;
  goUp(): boolean;
  move(direction: "next" | "previous"): void;
}) {
  const { openActive, select, goUp, move } = input;
  const handleWebKey = useCallback<BrowserKeyHandler>(
    (event) => {
      const mod = event.metaKey || event.ctrlKey;
      if (event.key === "Enter") {
        if (mod) select();
        else openActive();
        return true;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        move(event.key === "ArrowDown" ? "next" : "previous");
        return true;
      }
      if (event.key !== "Backspace" || mod || event.altKey) return false;
      return caretAtEnd(event.target) && goUp();
    },
    [goUp, move, openActive, select],
  );
  const handleNativeKeyPress = useCallback(
    ({ nativeEvent: { key } }: { nativeEvent: { key: string } }) => {
      if (key === "ArrowDown") move("next");
      if (key === "ArrowUp") move("previous");
    },
    [move],
  );
  return { handleWebKey, handleNativeKeyPress };
}

function caretAtEnd(target: EventTarget | null): boolean {
  if (typeof HTMLInputElement === "undefined") return true;
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
    return true;
  }
  const end = target.value.length;
  return target.selectionStart === end && target.selectionEnd === end;
}

function browseNotice(listing: BrowseListing, selectsParent: boolean): string | null {
  const { data, fresh, current } = listing;
  if (!fresh || !data) return null;
  if (!current.filter && !selectsParent && !data.folder.canSelect) {
    return "This Host’s Project policy does not allow this folder. Open a subfolder.";
  }
  if (data.folder.truncated) {
    return `Showing the first ${BROWSE_LIMIT} folders. Type a name to filter.`;
  }
  return null;
}

const styles = StyleSheet.create((theme) => ({
  container: { flexShrink: 1, minHeight: 0 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    paddingVertical: theme.spacing[1],
    outlineStyle: "none",
  } as object,
}));
