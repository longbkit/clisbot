import { useCallback } from "react";
import { View, Text } from "react-native";
import { Plus } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { quickStartOwnerKey } from "@clisbot/protocol/quick-starts/types";
import type { useQuickStarts } from "./use-quick-starts";
import { QuickStartEditor } from "./editor";
import { QuickStartRow } from "./row";
import { findDestination, type QuickStartDestination } from "./model";
import type { QuickStartLibrary } from "./use-library";
import { QuickStartPickerScope } from "./picker-scope";
import { styles } from "./styles";
interface Props {
  source: ReturnType<typeof useQuickStarts>;
  library: QuickStartLibrary;
  destinations: QuickStartDestination[];
  serverId: string;
}
export function LibraryBody(props: Props) {
  const { source, library, destinations, serverId } = props;
  const { edit, form, error, targetOpen, setTargetOpen, busy } = library;
  return (
    <View style={styles.body}>
      {error || source.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error ?? source.error?.message}
        </Text>
      ) : null}
      {!source.online ? (
        <Text style={styles.detail}>Host offline. Reconnect to save or start.</Text>
      ) : null}
      {edit && form ? (
        <>
          {edit.conflict ? (
            <View style={styles.group}>
              <Text style={styles.detail}>
                Your draft is kept. Load the latest version or save it as a new quick start.
              </Text>
              <View style={styles.row}>
                <Button variant="outline" onPress={library.reload}>
                  Load latest
                </Button>
                <Button variant="outline" onPress={library.saveCopy}>
                  Save as copy
                </Button>
              </View>
            </View>
          ) : null}
          <QuickStartPickerScope picker={library.picker} setPicker={library.setPicker}>
            <QuickStartEditor
              key={edit.id}
              edit={edit}
              form={form}
              destinations={destinations}
              serverId={serverId}
              targetOpen={targetOpen}
              setTargetOpen={setTargetOpen}
              busy={busy}
            />
          </QuickStartPickerScope>
          {edit.problem && edit.input.name.trim() ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {edit.problem}
            </Text>
          ) : null}
        </>
      ) : (
        <LibraryList {...props} />
      )}
    </View>
  );
}
function LibraryList({ source, library, destinations }: Props) {
  const items = source.data?.items ?? [];
  const preferences = source.data?.preferences;
  const pins = preferences?.pinnedIds ?? [];
  const { search, setSearch, create, apply, setMenu, menu, action, busy, draft, resume } = library;
  const mine = useCallback(
    (owner: (typeof items)[number]["owner"]) =>
      !!preferences && quickStartOwnerKey(owner) === quickStartOwnerKey(preferences.owner),
    [preferences],
  );
  const matching = items.filter((item) =>
    `${item.name} ${item.startingPrompt} ${
      findDestination(destinations, item.target)?.option.label ?? ""
    }`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  // Pinned first, in Home's order; then the rest split by who owns them.
  const pinned = pins.flatMap((id) => matching.find((item) => item.id === id) ?? []);
  const rest = matching.filter((item) => !pins.includes(item.id));
  const groups = [
    { key: "pinned", title: "Pinned on Home", items: pinned },
    { key: "mine", title: "Mine", items: rest.filter((item) => mine(item.owner)) },
    {
      key: "shared",
      title: "Shared on this Host",
      items: rest.filter((item) => !mine(item.owner)),
    },
  ];
  return (
    <>
      {items.length ? (
        <Text style={styles.detail}>Pin favorites to Home, or use any quick start.</Text>
      ) : null}
      <View style={styles.toolbar}>
        <View style={styles.grow}>
          <SearchField
            clearAccessibilityLabel="Clear search"
            value={search}
            onChangeText={setSearch}
            placeholder="Search quick starts"
          />
        </View>
        <Button variant="default" size="sm" leftIcon={Plus} onPress={create}>
          New quick start
        </Button>
      </View>
      {draft ? (
        <View style={styles.row}>
          <Text style={[styles.detail, styles.grow]}>You have an unsaved quick start.</Text>
          <Button variant="ghost" size="sm" onPress={resume}>
            Continue draft
          </Button>
        </View>
      ) : null}
      {source.isLoading ? <Text style={styles.detail}>Loading…</Text> : null}
      {groups.map((group) =>
        group.items.length ? (
          <View key={group.key} style={styles.libraryGroup}>
            <Text style={styles.groupLabel}>{group.title}</Text>
            {group.items.map((item) => (
              <QuickStartRow
                key={item.id}
                item={item}
                pinned={pins.includes(item.id)}
                mine={mine(item.owner)}
                destination={findDestination(destinations, item.target)}
                onApply={apply}
                onMenu={setMenu}
                menuOpen={menu?.id === item.id}
                onAction={action}
                disabled={busy || !source.online}
              />
            ))}
          </View>
        ) : null,
      )}
      {!source.isLoading && !matching.length ? (
        <View style={styles.empty}>
          <Text style={styles.text}>
            {search ? "No matching quick starts" : "No quick starts yet"}
          </Text>
          <Text style={[styles.detail, styles.centered]}>
            {search
              ? "Try another name, project or bot."
              : "Save a prompt with where it runs, then start it from Home in one tap."}
          </Text>
        </View>
      ) : null}
      {source.error ? (
        <Button variant="ghost" onPress={library.retry}>
          Try again
        </Button>
      ) : null}
    </>
  );
}
