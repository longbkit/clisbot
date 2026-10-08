import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ChannelIcon } from "@/clisbot/channels/channel-icon";
import { ComboboxItem } from "@/components/ui/combobox";
import { Field } from "@/components/ui/form-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import {
  SelectField,
  type SelectFieldOption,
  type SelectFieldRenderOptionInput,
} from "@/components/ui/select-field";
import type { ChannelCatalogEntry } from "../channel-catalog";

/** The channels offered one tap away, in this order, when this Hub can connect them. */
const POPULAR_CHANNELS = ["telegram", "whatsapp", "slack", "discord", "zalouser"] as const;
/** Segments stay a short choice (design.md §4: two to four options). */
const POPULAR_COUNT = 3;
const CHANNEL_ICON_SIZE = 16;
const STRIP_ICON_SIZE = 14;

/** The few channels most people connect, among the ones offered. */
export function popularChannelEntries(
  entries: readonly ChannelCatalogEntry[],
): ChannelCatalogEntry[] {
  return POPULAR_CHANNELS.flatMap((id) => entries.filter((entry) => entry.id === id)).slice(
    0,
    POPULAR_COUNT,
  );
}

/**
 * Which channel a new Connection is for: the popular ones as segments, and every
 * channel in a searchable list beside them. The list shows the choice when it is
 * not one of the segments, so exactly one of the two always says what is picked.
 */
export function ChannelPicker({
  entries,
  value,
  onChange,
}: {
  entries: readonly ChannelCatalogEntry[];
  value: string;
  onChange(channel: string): void;
}) {
  const { t } = useTranslation();
  const popular = useMemo(() => popularChannelEntries(entries), [entries]);
  const segments = useMemo<SegmentedControlOption<string>[]>(
    () =>
      popular.map((entry) => ({
        value: entry.id,
        label: entry.label,
        icon: ({ size }: { size: number }) => <ChannelIcon channel={entry.id} size={size} />,
      })),
    [popular],
  );
  const options = useMemo<SelectFieldOption<string>[]>(
    () => entries.map((entry) => ({ id: entry.id, value: entry.id, label: entry.label })),
    [entries],
  );
  const listed = popular.some((entry) => entry.id === value) ? null : value;
  const listedLabel = entries.find((entry) => entry.id === listed)?.label;
  const display = useMemo(
    () => (listedLabel === undefined ? null : { label: listedLabel }),
    [listedLabel],
  );
  // Until a channel from the list is picked, the list shows how many there are
  // and every channel's mark, so the three segments do not read as the whole offer.
  const icon = useMemo(
    () =>
      listed === null ? (
        <ChannelIconStrip entries={entries} />
      ) : (
        <ChannelIcon channel={listed} size={CHANNEL_ICON_SIZE} />
      ),
    [entries, listed],
  );
  const allLabel = t("hub.channels.picker.allCount", { count: entries.length });
  return (
    <Field label={t("hub.channels.picker.channel")}>
      <View style={styles.row}>
        {segments.length > 1 ? (
          <SegmentedControl options={segments} value={value} onValueChange={onChange} size="sm" />
        ) : null}
        <View style={styles.all}>
          <SelectField
            label={t("hub.channels.catalogView.allChannels")}
            field={false}
            size="sm"
            value={listed}
            selectedDisplay={display}
            options={options}
            onChange={onChange}
            placeholder={allLabel}
            emptyText={t("hub.channels.picker.noMatch")}
            searchable
            searchPlaceholder={t("hub.channels.picker.search")}
            title={t("hub.channels.picker.channel")}
            triggerLeading={icon}
            renderOption={renderChannelOption}
          />
        </View>
      </View>
    </Field>
  );
}

function renderChannelOption(input: SelectFieldRenderOptionInput<string>) {
  return <ChannelOptionRow {...input} />;
}

/** Every channel's mark, small, in catalog order: the list's preview. */
function ChannelIconStrip({ entries }: { entries: readonly ChannelCatalogEntry[] }) {
  return (
    <View style={styles.strip}>
      {entries.map((entry) => (
        <ChannelIcon key={entry.id} channel={entry.id} size={STRIP_ICON_SIZE} />
      ))}
    </View>
  );
}

/** One row of the list: the channel's brand mark, then its name. */
function ChannelOptionRow({
  option,
  selected,
  active,
  onPress,
}: SelectFieldRenderOptionInput<string>) {
  const icon = useMemo(
    () => <ChannelIcon channel={option.value} size={CHANNEL_ICON_SIZE} />,
    [option.value],
  );
  return (
    <ComboboxItem
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={icon}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  // On a narrow screen the list wraps under the segments instead of overflowing.
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  // Wide enough for the icon strip and "All N channels" side by side.
  all: {
    flexGrow: 1,
    flexBasis: 320,
    minWidth: 260,
  },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
}));
