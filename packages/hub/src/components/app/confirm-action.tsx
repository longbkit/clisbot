import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog.js";
import { Button } from "../ui/button.js";
import { DropdownMenuItem } from "../ui/dropdown-menu.js";

export interface Confirmation {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  /** Renders the confirmed action in destructive red inside the dialog. */
  destructive?: boolean;
}

const RequestConfirmation = createContext<(confirmation: Confirmation) => void>(() => {});

/**
 * Hosts the confirmation dialog for everything rendered inside it. The dialog must
 * outlive its trigger: a menu item unmounts the moment the menu closes, so a dialog
 * mounted alongside the item would either vanish or force the menu to stay open
 * behind it. The scope sits outside the menu and survives both.
 */
export function ConfirmationScope({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Confirmation>();
  const dismiss = useCallback((open: boolean) => {
    if (!open) setPending(undefined);
  }, []);

  return (
    <RequestConfirmation.Provider value={setPending}>
      {children}
      {pending === undefined ? null : (
        <ConfirmDialog confirmation={pending} open onOpenChange={dismiss} />
      )}
    </RequestConfirmation.Provider>
  );
}

/**
 * A destructive action inside a `RowActions` menu. Red appears only after the user
 * has shown intent, so the menu item is quiet and the destructive button lives in
 * the dialog.
 */
export function ConfirmMenuItem({
  label,
  busy = false,
  ...confirmation
}: Confirmation & { label: string; busy?: boolean }) {
  const request = useContext(RequestConfirmation);
  const { title, description, confirmLabel, cancelLabel, onConfirm, destructive } = confirmation;
  const select = useCallback(() => {
    request({
      title,
      description,
      confirmLabel,
      cancelLabel,
      onConfirm,
      ...(destructive === undefined ? {} : { destructive }),
    });
  }, [request, title, description, confirmLabel, cancelLabel, onConfirm, destructive]);

  return (
    <DropdownMenuItem disabled={busy} onSelect={select}>
      {label}
    </DropdownMenuItem>
  );
}

/**
 * A standalone confirmed action. The button on the page is outline; the destructive
 * button is the one inside the dialog.
 */
export function ConfirmAction({
  label,
  busy = false,
  ...confirmation
}: Confirmation & { label: string; busy?: boolean }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={busy}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <ConfirmBody confirmation={confirmation} busy={busy} />
    </AlertDialog>
  );
}

function ConfirmDialog({
  confirmation,
  open,
  onOpenChange,
}: {
  confirmation: Confirmation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <ConfirmBody confirmation={confirmation} busy={false} />
    </AlertDialog>
  );
}

function ConfirmBody({ confirmation, busy }: { confirmation: Confirmation; busy: boolean }) {
  const {
    title,
    description,
    confirmLabel,
    cancelLabel,
    onConfirm,
    destructive = true,
  } = confirmation;
  return (
    <AlertDialogContent className="sm:max-w-sm">
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel type="button" disabled={busy}>
          {cancelLabel}
        </AlertDialogCancel>
        <AlertDialogAction
          variant={destructive ? "destructive" : "default"}
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}
