import { createContext, useContext, useMemo, useCallback, type ReactNode } from "react";
const Context = createContext<{
  picker: string | null;
  setPicker: (id: string | null) => void;
} | null>(null);
export function QuickStartPickerScope({
  picker,
  setPicker,
  children,
}: {
  picker: string | null;
  setPicker: (id: string | null) => void;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ picker, setPicker }), [picker, setPicker]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useQuickStartPicker(id: string) {
  const scope = useContext(Context);
  const setPicker = scope?.setPicker;
  const onOpenChange = useCallback(
    (open: boolean) => setPicker?.(open ? id : null),
    [setPicker, id],
  );
  return { open: scope?.picker === id, onOpenChange };
}
