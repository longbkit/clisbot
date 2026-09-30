import type { ClisbotApi } from "@clisbot/client";
import { createContext, useContext, type ReactNode } from "react";

const ClisbotApiContext = createContext<ClisbotApi | null>(null);

export function useClisbotContextValue(): ClisbotApi | null {
  return useContext(ClisbotApiContext);
}

export function ClisbotApiProvider({
  children,
  clisbot,
}: {
  children: ReactNode;
  clisbot: ClisbotApi;
}) {
  return <ClisbotApiContext.Provider value={clisbot}>{children}</ClisbotApiContext.Provider>;
}

export function useClisbot(): ClisbotApi {
  const clisbot = useClisbotContextValue();
  if (!clisbot) throw new Error("useClisbot must run inside a contributed plugin surface");
  return clisbot;
}
