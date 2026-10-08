import { useCallback, useState, type ComponentType } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Bot, FolderOpen } from "lucide-react-native";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useBotCreationHosts } from "@/clisbot/bots/feature";
import { useCreationRequest } from "@/clisbot/bots/sidebar/creation-request";
import type { Theme } from "@/styles/theme";
import { settingsStyles } from "@/styles/settings";
import { homeCopy } from "./copy";

const BotIcon = withUnistyles(Bot);
const FolderIcon = withUnistyles(FolderOpen);
// Neutral: accent is the one CTA on a surface (docs/design.md); these cards are choices.
/** Say why the card is off: no Host can create bots, or the bot list is still loading. */
function createBotDescription(hasCreationHost: boolean, sidebarReady: boolean): string {
  if (!hasCreationHost) return homeCopy.actions.createBotUnavailable;
  return sidebarReady ? homeCopy.actions.createBotDescription : homeCopy.actions.createBotLoading;
}

const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * The two ways to start, side by side and equal: a bot first, then a project. New bot opens the
 * sidebar's creation sheet, so it needs a mounted sidebar and a Host that can create bots.
 */
export function HomeActions() {
  const openProjectPicker = useOpenAddProject();
  const creationHosts = useBotCreationHosts();
  const sidebarCanCreate = useCreationRequest((state) => state.handlers > 0);
  const ask = useCreationRequest((state) => state.ask);
  const canCreateBot = sidebarCanCreate && creationHosts.length > 0;
  const createBot = useCallback(() => ask("bot"), [ask]);
  const addProject = useCallback(() => void openProjectPicker(), [openProjectPicker]);
  return (
    <View style={styles.row}>
      <ActionCard
        Icon={BotIcon}
        title={homeCopy.actions.createBot}
        description={createBotDescription(creationHosts.length > 0, sidebarCanCreate)}
        onPress={createBot}
        disabled={!canCreateBot}
        testID="home-create-bot"
      />
      <ActionCard
        Icon={FolderIcon}
        title={homeCopy.actions.addProject}
        description={homeCopy.actions.addProjectDescription}
        onPress={addProject}
        testID="open-project-submit"
      />
    </View>
  );
}

function ActionCard({
  Icon,
  title,
  description,
  onPress,
  disabled = false,
  testID,
}: {
  Icon: ComponentType<{ size: number; uniProps: typeof iconColor }>;
  title: string;
  description: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const style = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      settingsStyles.card,
      styles.card,
      hovered && !disabled && styles.hovered,
      pressed && styles.pressed,
      disabled && styles.disabled,
    ],
    [hovered, disabled],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={disabled ? DISABLED : ENABLED}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      testID={testID}
      style={style}
    >
      <Icon size={22} uniProps={iconColor} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </Pressable>
  );
}

const DISABLED = { disabled: true };
const ENABLED = { disabled: false };

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: { xs: "column", md: "row" }, gap: theme.spacing[3] },
  // The shell is the settings card (border, radius, lift); this only lays out the inside.
  card: { flex: 1, padding: theme.spacing[4], gap: theme.spacing[2] },
  hovered: { backgroundColor: theme.colors.surface2 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
