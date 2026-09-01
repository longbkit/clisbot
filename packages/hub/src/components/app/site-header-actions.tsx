import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

const SiteHeaderActionsContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

export function SiteHeaderActionsProvider({ children }: { children: ReactNode }) {
  const target = useRef<HTMLDivElement>(null);
  return (
    <SiteHeaderActionsContext.Provider value={target}>{children}</SiteHeaderActionsContext.Provider>
  );
}

export function SiteHeaderActionsTarget() {
  const target = useContext(SiteHeaderActionsContext);
  if (target === null) throw new Error("site header actions require their provider");
  return <div ref={target} className="ml-auto flex shrink-0 items-center gap-2" />;
}

export function SiteHeaderActions({ children }: { children: ReactNode }) {
  const target = useContext(SiteHeaderActionsContext);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && target?.current != null ? createPortal(children, target.current) : null;
}
