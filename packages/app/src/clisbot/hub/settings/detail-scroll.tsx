import { createContext, useContext, type ReactNode } from "react";

const HubSettingsDetailScrollContext = createContext<(() => void) | null>(null);

/** Uses the existing Settings ScrollView on every platform. */
export function HubSettingsDetailScrollProvider({
  onNavigate,
  children,
}: {
  onNavigate(): void;
  children: ReactNode;
}) {
  return (
    <HubSettingsDetailScrollContext.Provider value={onNavigate}>
      {children}
    </HubSettingsDetailScrollContext.Provider>
  );
}

export function useHubSettingsDetailScroll() {
  return useContext(HubSettingsDetailScrollContext);
}
