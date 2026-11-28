import type { PluginClisbotApi } from "./reference-api.js";
import { createContext, useContext, type ReactNode } from "react";

const ClisbotApiContext = createContext<PluginClisbotApi | null>(null);

export function useClisbotContextValue(): PluginClisbotApi | null {
  return useContext(ClisbotApiContext);
}

export function ClisbotApiProvider({
  children,
  clisbot,
}: {
  children: ReactNode;
  clisbot: PluginClisbotApi;
}) {
  return <ClisbotApiContext.Provider value={clisbot}>{children}</ClisbotApiContext.Provider>;
}

export function useClisbot(): PluginClisbotApi {
  const clisbot = useClisbotContextValue();
  if (!clisbot) throw new Error("useClisbot must run inside a contributed plugin surface");
  return clisbot;
}
