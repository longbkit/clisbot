import { useFormLifetime } from "@/clisbot/bots/create/use-form-lifetime";
import { useState, useCallback, useRef } from "react";
import type { QuickStartInput, QuickStartView } from "@clisbot/protocol/quick-starts/types";
import type { useQuickStarts } from "./use-quick-starts";
import type { QuickStartDestination } from "./model";
import { useQuickStartWebNavigation } from "./use-web-navigation";
import { useQuickStartEditor, newQuickStartId } from "./use-editor";
import { useQuickStartMutation, useQuickStartAction } from "./use-mutations";
export function useQuickStartLibrary(
  source: ReturnType<typeof useQuickStarts>,
  snapshot: () => QuickStartInput | null,
  onApply: (item: QuickStartInput) => void,
  destinations: QuickStartDestination[],
) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<QuickStartView | null>(null);
  const { busy, error, setError, run } = useQuickStartMutation(source.refetch);
  const showEditor = useCallback(() => {
    setMenu(null);
    setOpen(true);
  }, []);
  const editor = useQuickStartEditor(snapshot, showEditor, setError, destinations);
  const { edit, startEdit } = editor;
  const close = useQuickStartDialogs({
    open,
    busy,
    menu,
    editor,
    setMenu,
    setOpen,
    setError,
  });
  const closeMenu = useCallback(() => setMenu(null), []);
  const openLibrary = useCallback(() => setOpen(true), []);
  const { refetch } = source;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  const create = useCallback(() => startEdit(), [startEdit]);
  const { apply, save } = useQuickStartSubmission({
    source,
    onApply,
    setOpen,
    edit,
    editor,
    run,
    setError,
  });
  const action = useQuickStartAction({
    source,
    menu,
    run,
    startEdit,
    closeMenu,
  });
  return {
    open,
    search,
    setSearch,
    menu,
    setMenu,
    ...editor,
    busy,
    error,
    close,
    closeMenu,
    openLibrary,
    retry,
    create,
    apply,
    save,
    action,
    ...useConflictRecovery(source, editor, setError),
  };
}
export type QuickStartLibrary = ReturnType<typeof useQuickStartLibrary>;

function useQuickStartSubmission({
  source,
  onApply,
  setOpen,
  edit,
  editor,
  run,
  setError,
}: {
  source: ReturnType<typeof useQuickStarts>;
  onApply: (item: QuickStartInput) => void;
  setOpen: (open: boolean) => void;
  edit: ReturnType<typeof useQuickStartEditor>["edit"];
  editor: ReturnType<typeof useQuickStartEditor>;
  run: ReturnType<typeof useQuickStartMutation>["run"];
  setError: ReturnType<typeof useQuickStartMutation>["setError"];
}) {
  const apply = useCallback(
    (item: QuickStartView) => {
      if (!source.online || !item.available) {
        setError(
          "This destination is unavailable. Reconnect or edit the quick start to choose another.",
        );
        return;
      }
      onApply(item);
      setOpen(false);
    },
    [onApply, source.online, setError, setOpen],
  );
  const save = useCallback(() => {
    if (edit?.canSave && source.client)
      void run(
        () =>
          source.client!.saveQuickStart({
            id: edit.id,
            expectedRevision: edit.revision,
            input: edit.input,
          }),
        editor.finish,
        (code) => {
          if (code === "conflict") editor.form?.setConflict();
        },
      );
  }, [edit, source.client, run, editor]);
  return { apply, save };
}

function useQuickStartDialogs({
  open,
  busy,
  menu,
  editor,
  setMenu,
  setOpen,
  setError,
}: {
  open: boolean;
  busy: boolean;
  menu: QuickStartView | null;
  editor: ReturnType<typeof useQuickStartEditor>;
  setMenu: (item: QuickStartView | null) => void;
  setOpen: (open: boolean) => void;
  setError: (message: string | null) => void;
}) {
  const { edit, setEdit, picker, setPicker } = editor;
  const restore = useCallback(
    (frame: { open: boolean; edit: typeof edit; menu: typeof menu; picker: string | null }) => {
      setPicker(frame.picker);
      setMenu(frame.menu);
      if (frame.edit) setEdit(frame.edit);
      else setEdit(null);
      setOpen(frame.open);
    },
    [setEdit, setMenu, setOpen, setPicker],
  );
  useQuickStartWebNavigation({ open, edit, menu, picker }, restore);
  const close = useCallback(() => {
    if (busy) return;
    if (picker) setPicker(null);
    else if (menu) setMenu(null);
    else if (edit) setEdit(null);
    else setOpen(false);
    setError(null);
  }, [busy, menu, edit, picker, setPicker, setEdit, setError, setMenu, setOpen]);
  return close;
}

function useConflictRecovery(
  source: ReturnType<typeof useQuickStarts>,
  editor: ReturnType<typeof useQuickStartEditor>,
  setError: (message: string | null) => void,
) {
  const active = useFormLifetime();
  const current = useRef(editor.form);
  current.current = editor.edit ? editor.form : null;
  const reload = useCallback(async () => {
    const response = await source.refetch();
    if (!active() || !editor.edit || current.current !== editor.form) return;
    const latest = response.data?.items?.find((item) => item.id === editor.edit?.id);
    if (!latest) {
      setError("This quick start is no longer available. Save your draft as a copy.");
      return;
    }
    editor.setEdit({ id: latest.id, revision: latest.revision, input: latest });
    setError(null);
  }, [source, editor, setError, active]);
  const saveCopy = useCallback(() => {
    if (!editor.edit) return;
    editor.setEdit({
      id: newQuickStartId(),
      revision: 0,
      input: {
        ...editor.edit.input,
        name: `${editor.edit.input.name} copy`,
        visibility: "personal",
      },
    });
    setError(null);
  }, [editor, setError]);
  return { reload, saveCopy };
}
