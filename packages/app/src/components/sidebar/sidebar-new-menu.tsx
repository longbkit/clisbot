import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Bot, FolderPlus, Hash, Import, Plus } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { buttonControlHeight, MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHasFinePointer } from "@/hooks/use-fine-pointer";
import { useHoverSafeZone } from "@/hooks/use-hover-safe-zone";
import { useOpenNewWorkspace } from "@/hooks/use-open-new-workspace";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useBotCreationHosts, useBotsFeatureHosts } from "@/clisbot/bots/feature";
import { botsRuntime } from "@/clisbot/bots/data/runtime";
import { useBotsQuery } from "@/clisbot/bots/data/use-bots";
import { useCreationRequest } from "@/clisbot/bots/sidebar/creation-request";
import { usePanelStore } from "@/stores/panel-store";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedPlus = withUnistyles(Plus);
const ThemedFolderPlus = withUnistyles(FolderPlus);
const ThemedBot = withUnistyles(Bot);
const ThemedHash = withUnistyles(Hash);
const ThemedImport = withUnistyles(Import);
const muted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentForeground = (theme: Theme) => ({ color: theme.colors.accentForeground });
const workspaceIcon = <ThemedPlus size={ICON_SIZE.sm} uniProps={muted} />;
const projectIcon = <ThemedFolderPlus size={ICON_SIZE.sm} uniProps={muted} />;
const botIcon = <ThemedBot size={ICON_SIZE.sm} uniProps={muted} />;
const groupIcon = <ThemedHash size={ICON_SIZE.sm} uniProps={muted} />;
const importIcon = <ThemedImport size={ICON_SIZE.sm} uniProps={muted} />;

/** Opens by hover on desktop or by press on every surface, using the shared menu engine. */
export function SidebarNewMenu({
  onAddProject,
  onImportSession,
}: {
  onAddProject: () => void;
  onImportSession: () => void;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const finePointer = useHasFinePointer();
  const touchTarget = compact || !finePointer;
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const openWorkspace = useOpenNewWorkspace(compact ? showMobileAgent : undefined);
  const workspaceKeys = useShortcutKeys("new-workspace");
  const projectKeys = useShortcutKeys("new-agent");
  const workspaceShortcut = useMemo(
    () => (workspaceKeys ? <Shortcut chord={workspaceKeys} /> : null),
    [workspaceKeys],
  );
  const projectShortcut = useMemo(
    () => (projectKeys ? <Shortcut chord={projectKeys} /> : null),
    [projectKeys],
  );
  const featureHosts = useBotsFeatureHosts();
  const creationHosts = useBotCreationHosts();
  const hosts = useMemo(
    () => featureHosts.map((host) => ({ serverId: host.serverId, serverName: host.label })),
    [featureHosts],
  );
  const bots = useBotsQuery({ hosts, runtime: botsRuntime });
  const sidebarCanCreate = useCreationRequest((state) => state.handlers > 0);
  const ask = useCreationRequest((state) => state.ask);
  const [open, setOpen] = useState(false);
  const [hoverOpened, setHoverOpened] = useState(false);
  const triggerRef = useRef<View | null>(null);
  const contentRef = useRef<View | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHoverTimer = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }, []);
  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  useEffect(
    () => () => {
      clearHoverTimer();
      clearCloseTimer();
    },
    [clearHoverTimer, clearCloseTimer],
  );
  const changeOpen = useCallback(
    (next: boolean) => {
      clearHoverTimer();
      clearCloseTimer();
      setHoverOpened(false);
      setOpen(next);
    },
    [clearHoverTimer, clearCloseTimer],
  );
  const hoverOpen = useCallback(() => {
    if (!finePointer || compact) return;
    clearHoverTimer();
    clearCloseTimer();
    if (open) return;
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null;
      setHoverOpened(true);
      setOpen(true);
    }, 180);
  }, [compact, finePointer, open, clearHoverTimer, clearCloseTimer]);
  const hoverClose = useCallback(() => {
    if (closeTimer.current) return;
    closeTimer.current = setTimeout(() => changeOpen(false), 260);
  }, [changeOpen]);
  // The backdrop covers the trigger when the menu opens. Its synthetic pointer leave must not
  // close the menu: track actual pointer movement across trigger, surface and their gap instead.
  useHoverSafeZone({
    enabled: open && hoverOpened && finePointer && !compact,
    triggerRef,
    contentRef,
    onEnterSafeZone: clearCloseTimer,
    onLeaveSafeZone: hoverClose,
  });
  const createBot = useCallback(() => ask("bot"), [ask]);
  const createGroup = useCallback(() => ask("group"), [ask]);
  const canCreateBot = sidebarCanCreate && creationHosts.length > 0;
  const canCreateGroup =
    sidebarCanCreate && bots.loadState.status === "loaded" && bots.loadState.data.length > 0;

  return (
    <DropdownMenu open={open} onOpenChange={changeOpen} compactMode="sheet">
      <View
        ref={triggerRef}
        collapsable={false}
        onPointerEnter={hoverOpen}
        onPointerLeave={clearHoverTimer}
      >
        <DropdownMenuTrigger
          style={touchTarget ? styles.touchTrigger : styles.trigger}
          testID="sidebar-new"
          accessibilityRole="button"
          accessibilityLabel={t("sidebar.actions.new")}
        >
          <ThemedPlus
            size={touchTarget ? ICON_SIZE.lg : ICON_SIZE.md}
            uniProps={accentForeground}
          />
        </DropdownMenuTrigger>
      </View>
      <DropdownMenuContent
        side="top"
        align="start"
        offset={4}
        width={240}
        sheetTitle={t("sidebar.actions.new")}
        testID="sidebar-new-menu"
        surfaceRef={contentRef}
      >
        <View>
          <DropdownMenuItem
            style={touchTarget ? styles.touchItem : undefined}
            leading={workspaceIcon}
            trailing={workspaceShortcut}
            onSelect={openWorkspace}
            testID="sidebar-new-workspace"
          >
            {t("sidebar.actions.newWorkspace")}
          </DropdownMenuItem>
          <DropdownMenuItem
            style={touchTarget ? styles.touchItem : undefined}
            leading={projectIcon}
            trailing={projectShortcut}
            onSelect={onAddProject}
            testID="sidebar-new-project"
          >
            {t("sidebar.actions.newProject")}
          </DropdownMenuItem>
          {featureHosts.length > 0 ? (
            <>
              <DropdownMenuItem
                style={touchTarget ? styles.touchItem : undefined}
                leading={botIcon}
                disabled={!canCreateBot}
                onSelect={createBot}
                testID="sidebar-new-bot"
              >
                {t("sidebar.actions.newBot")}
              </DropdownMenuItem>
              <DropdownMenuItem
                style={touchTarget ? styles.touchItem : undefined}
                leading={groupIcon}
                disabled={!canCreateGroup}
                onSelect={createGroup}
                testID="sidebar-new-group"
              >
                {t("sidebar.actions.newGroup")}
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            style={touchTarget ? styles.touchItem : undefined}
            leading={importIcon}
            onSelect={onImportSession}
            testID="sidebar-new-import-session"
          >
            {t("importSession.title")}
          </DropdownMenuItem>
        </View>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: buttonControlHeight.sm,
    height: buttonControlHeight.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.accent,
  },
  touchTrigger: {
    width: MIN_TOUCH_TARGET_SIZE,
    height: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.accent,
  },
  touchItem: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
  },
}));
