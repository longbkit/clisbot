import { useContext, type Context, type ReactNode } from "react";
import { useHeldWhileInactive } from "@/hooks/use-held-while-inactive";
import { useRetainedPanelActive } from "./retained-panel";

/**
 * Re-provides `context` as it was when the surrounding retained panel was hidden, so consumers
 * below skip every update until the panel is shown, then render once with the latest value
 * (docs/mobile-panels.md). Pass a stable `children` element, or the boundary's own re-render
 * reaches them anyway.
 */
export function HeldContextValue<T>({
  context,
  children,
}: {
  context: Context<T>;
  children: ReactNode;
}) {
  const value = useHeldWhileInactive(useContext(context), useRetainedPanelActive());
  return <context.Provider value={value}>{children}</context.Provider>;
}
