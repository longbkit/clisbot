import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FileSymlink } from "lucide-react-native";
import {
  Pressable,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import { TrailingActionScrim } from "@/components/ui/trailing-action-scrim";
import { DIFF_FILE_HEADER_RIGHT, showsFileHeaderOpenAction } from "@/git/file-header-presentation";

const ThemedFileSymlinkIcon = withUnistyles(FileSymlink);
const GLYPH_SIZE = iconButtonChromeGlyphSize("small");

const buttonStyle = (state: PressableStateCallbackType & { hovered?: boolean }) =>
  iconButtonChromeStyle({ size: "small", state });

interface FileHeaderOpenActionProps {
  path: string;
  isDeleted: boolean;
  onOpenFile?: (path: string) => void;
  /** A document header shows the action permanently; a tree row reveals it on hover. */
  isDocumentHeader: boolean;
  /** A painted header reserves the rail, so only a React-drawn one has content to mask. */
  canvasRendered: boolean;
  isHovered: boolean;
  testID?: string;
}

/**
 * Opens the file a diff header names — the affordance the context menu otherwise hides.
 *
 * It overlays the trailing rail rather than joining the header's flex row, for two reasons. A
 * document header is painted on a canvas, so there is no flex row to join: the painter leaves
 * DIFF_FILE_HEADER_ACTION_SLOT free here instead. A tree row does have one, but holding a slot
 * open in it would push every file row's trailing glyph 28px inboard of the folder rows beside
 * it. Overlaying costs the tree row no geometry at all, so the scrim masks the change icon
 * underneath while the row is hovered — the same trick the sidebar workspace row plays on its
 * diff stat.
 */
export function FileHeaderOpenAction({
  path,
  isDeleted,
  onOpenFile,
  isDocumentHeader,
  canvasRendered,
  isHovered,
  testID,
}: FileHeaderOpenActionProps) {
  const { t } = useTranslation();
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      // The header underneath toggles the diff body; one press must not do both.
      event.stopPropagation?.();
      onOpenFile?.(path);
    },
    [onOpenFile, path],
  );
  const shows = showsFileHeaderOpenAction({
    canOpen: Boolean(onOpenFile),
    isDeleted,
    isDocumentHeader,
    isHovered,
  });
  if (!shows) return null;
  // Each surface names the background it is hovered on, so the scrim fades into it.
  const scrimBackdrop = isDocumentHeader ? "surface1" : "surfaceSidebarHover";
  return (
    // The header's own pressable carries zIndex 2, so the action needs a layer of its own to
    // sit above it; box-none keeps every press that misses the button going to the header.
    <View style={styles.layer} pointerEvents="box-none">
      {canvasRendered ? null : <TrailingActionScrim backdrop={scrimBackdrop} />}
      <View style={styles.rail} pointerEvents="box-none">
        <Pressable
          onPress={handlePress}
          style={buttonStyle}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.fileActions.openFile")}
          testID={testID ? `${testID}-open` : undefined}
        >
          <ThemedFileSymlinkIcon size={GLYPH_SIZE} uniProps={mutedIconColorMapping} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 3,
    elevation: 3,
  },
  rail: {
    position: "absolute",
    right: DIFF_FILE_HEADER_RIGHT,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
});
