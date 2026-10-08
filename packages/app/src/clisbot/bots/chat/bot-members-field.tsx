import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react-native";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { Field } from "@/components/ui/form-field";
import { SelectFieldTrigger } from "@/components/ui/select-field";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { BotFace } from "./bot-face";

const RemoveIcon = withUnistyles(X);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface MemberBot {
  id: string;
  name: string;
  description?: string | null;
  avatar?: string | null;
}

/**
 * A group's members, in New group chat and Group settings alike: the bots already in the group
 * are listed, and one search field adds more. `autoOpen` opens the search when the form opens.
 */
export function BotMembersField({
  members,
  available,
  onAdd,
  onRemove,
  disabled = false,
  isLocked,
  autoOpen = false,
  size = "md",
}: {
  members: readonly MemberBot[];
  /** Bots that can still be added. */
  available: readonly MemberBot[];
  onAdd: (botId: string) => void;
  onRemove: (botId: string) => void;
  disabled?: boolean;
  /** A member that cannot be removed right now, such as the last one of an existing group. */
  isLocked?: (botId: string) => boolean;
  autoOpen?: boolean;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation();
  const count = useMemo(
    () => (
      <Text style={styles.count}>{t("bots.chat.members.count", { count: members.length })}</Text>
    ),
    [members.length, t],
  );
  return (
    <Field label={t("bots.chat.common.members")} trailing={count}>
      <View style={styles.stack}>
        <AddBotSearch
          available={available}
          onAdd={onAdd}
          disabled={disabled}
          autoOpen={autoOpen}
          size={size}
        />
        {members.length > 0 ? (
          <View style={settingsStyles.card}>
            {members.map((bot, index) => (
              <MemberRow
                key={bot.id}
                bot={bot}
                withBorder={index > 0}
                removable={!disabled && !(isLocked?.(bot.id) ?? false)}
                onRemove={onRemove}
              />
            ))}
          </View>
        ) : null}
      </View>
    </Field>
  );
}

function AddBotSearch({
  available,
  onAdd,
  disabled,
  autoOpen,
  size,
}: {
  available: readonly MemberBot[];
  onAdd: (botId: string) => void;
  disabled: boolean;
  autoOpen: boolean;
  size: "sm" | "md";
}) {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(autoOpen && available.length > 0);
  const byId = useMemo(() => new Map(available.map((bot) => [bot.id, bot])), [available]);
  const options = useMemo<ComboboxOption[]>(
    () =>
      available.map((bot) => ({
        id: bot.id,
        label: bot.name,
        description: bot.description?.trim() || undefined,
      })),
    [available],
  );
  const toggleOpen = useCallback(() => setOpen((current) => !current), []);
  const renderOption = useCallback(
    (input: { option: ComboboxOption; active: boolean; onPress: () => void }): ReactElement => (
      <BotOption bot={byId.get(input.option.id)} {...input} />
    ),
    [byId],
  );
  const placeholder =
    available.length > 0 ? t("bots.chat.members.addPlaceholder") : t("bots.chat.members.allAdded");
  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          onPress={toggleOpen}
          disabled={disabled || available.length === 0}
          accessibilityRole="button"
          accessibilityLabel={t("bots.chat.members.addBot")}
        >
          {({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => (
            <SelectFieldTrigger
              placeholder={placeholder}
              hovered={Boolean(hovered)}
              active={pressed || open}
              disabled={disabled || available.length === 0}
              size={size}
            />
          )}
        </Pressable>
      </View>
      <Combobox
        anchorRef={anchorRef}
        open={open}
        onOpenChange={setOpen}
        options={options}
        value=""
        onSelect={onAdd}
        renderOption={renderOption}
        searchable
        keepOpenOnSelect
        searchPlaceholder={t("bots.chat.members.searchPlaceholder")}
        emptyText={t("bots.chat.members.noMatch")}
        title={t("bots.chat.members.addBot")}
      />
    </>
  );
}

/** One search result: the bot's face, name and role. */
function BotOption({
  bot,
  option,
  active,
  onPress,
}: {
  bot: MemberBot | undefined;
  option: ComboboxOption;
  active: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const face = useMemo(
    () => (bot ? <BotFace botId={bot.id} name={bot.name} avatar={bot.avatar} /> : null),
    [bot],
  );
  return (
    <ComboboxItem
      label={option.label}
      description={option.description ?? t("bots.chat.common.noRole")}
      active={active}
      onPress={onPress}
      leadingSlot={face}
    />
  );
}

function MemberRow({
  bot,
  withBorder,
  removable,
  onRemove,
}: {
  bot: MemberBot;
  withBorder: boolean;
  removable: boolean;
  onRemove: (botId: string) => void;
}) {
  const { t } = useTranslation();
  const remove = useCallback(() => onRemove(bot.id), [bot.id, onRemove]);
  const rowStyle = useMemo(
    () => [settingsStyles.row, withBorder ? settingsStyles.rowBorder : null, styles.row],
    [withBorder],
  );
  const role = bot.description?.trim();
  return (
    <View style={rowStyle}>
      <BotFace botId={bot.id} name={bot.name} avatar={bot.avatar} />
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {bot.name}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {role || t("bots.chat.common.noRole")}
        </Text>
      </View>
      {removable ? (
        <Pressable
          onPress={remove}
          accessibilityRole="button"
          accessibilityLabel={t("bots.chat.members.remove", { name: bot.name })}
          style={removeStyle}
        >
          <RemoveIcon size={16} uniProps={mutedIcon} />
        </Pressable>
      ) : null}
    </View>
  );
}

function removeStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.remove, (hovered || pressed) && styles.removeHovered];
}

const styles = StyleSheet.create((theme) => ({
  stack: { gap: theme.spacing[2] },
  count: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  row: { justifyContent: "flex-start", gap: theme.spacing[3] },
  remove: { padding: theme.spacing[1], borderRadius: theme.borderRadius.sm },
  removeHovered: { backgroundColor: theme.colors.surface2 },
}));
