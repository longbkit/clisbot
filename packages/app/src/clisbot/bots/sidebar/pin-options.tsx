import { useEffect, useCallback } from "react";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { Pin, PinOff, Settings } from "lucide-react-native";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useMenuContext } from "@/components/ui/menu";
import type { Rect } from "@/components/ui/menu/menu-anchor";

const PinIcon = withUnistyles(Pin);
const UnpinIcon = withUnistyles(PinOff);
const SettingsIcon = withUnistyles(Settings);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const pinIcon = <PinIcon size={16} uniProps={iconColor} />;
const unpinIcon = <UnpinIcon size={16} uniProps={iconColor} />;
const settingsIcon = <SettingsIcon size={16} uniProps={iconColor} />;

interface PinOptionsProps {
  visible: boolean;
  anchor?: Rect;
  title: string;
  pinned: boolean;
  onToggle: () => void;
  onClose: () => void;
  onConfigure?: () => void;
}

/** Shared menu engine: anchored desktop menu and compact bottom sheet. */
export function PinOptionsMenu(props: PinOptionsProps) {
  const { onClose } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  return (
    <DropdownMenu open={props.visible} onOpenChange={onOpenChange} compactMode="sheet">
      <PinOptionsContent {...props} />
    </DropdownMenu>
  );
}

function PinOptionsContent({ anchor, title, pinned, onToggle, onConfigure }: PinOptionsProps) {
  const { setAnchorRect, anchorRect } = useMenuContext("PinOptionsContent");
  useEffect(() => {
    setAnchorRect(anchor ?? null);
  }, [anchor, setAnchorRect]);
  if (!anchorRect) return null;
  return (
    <DropdownMenuContent side="bottom" align="end" sheetTitle={title}>
      <DropdownMenuItem onSelect={onToggle} leading={pinned ? unpinIcon : pinIcon}>
        {pinned ? "Unpin" : "Pin to sidebar"}
      </DropdownMenuItem>
      {onConfigure ? (
        <DropdownMenuItem onSelect={onConfigure} leading={settingsIcon}>
          Bot settings
        </DropdownMenuItem>
      ) : null}
    </DropdownMenuContent>
  );
}
