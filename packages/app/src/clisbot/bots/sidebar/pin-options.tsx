import { useEffect, useCallback } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useMenuContext } from "@/components/ui/menu";
import type { Rect } from "@/components/ui/anchor";
import type { ChatResourceAction, ChatResourceActionId } from "../chat/chat-resource-actions";
import { resourceActionIcon } from "../chat/chat-resource-icons";

interface RowOptionsProps {
  visible: boolean;
  anchor?: Rect;
  title: string;
  /** From `chatResourceActions`, so this menu and the chat options menu stay one list. */
  actions: readonly ChatResourceAction[];
  onSelect: (id: ChatResourceActionId) => void;
  onClose: () => void;
}

/** A sidebar row's menu. Shared menu engine: anchored desktop menu and compact bottom sheet. */
export function PinOptionsMenu(props: RowOptionsProps) {
  const { onClose } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  return (
    <DropdownMenu open={props.visible} onOpenChange={onOpenChange} compactMode="sheet">
      <RowOptionsContent {...props} />
    </DropdownMenu>
  );
}

function RowOptionsContent({ anchor, title, actions, onSelect }: RowOptionsProps) {
  const { setAnchorRect, anchorRect } = useMenuContext("PinOptionsContent");
  useEffect(() => {
    setAnchorRect(anchor ?? null);
  }, [anchor, setAnchorRect]);
  if (!anchorRect) return null;
  return (
    <DropdownMenuContent side="bottom" align="end" sheetTitle={title}>
      {actions.map((action) => (
        <RowOption key={action.id} action={action} onSelect={onSelect} />
      ))}
    </DropdownMenuContent>
  );
}

function RowOption({
  action,
  onSelect,
}: {
  action: ChatResourceAction;
  onSelect: (id: ChatResourceActionId) => void;
}) {
  const select = useCallback(() => onSelect(action.id), [action.id, onSelect]);
  const icon = resourceActionIcon(action);
  return (
    <DropdownMenuItem onSelect={select} leading={icon}>
      {action.label}
    </DropdownMenuItem>
  );
}
