import { QueryClientProvider } from "@tanstack/react-query";
import {
  ClisbotApiProvider,
  PluginRpcProvider,
  PluginTranslationProvider,
} from "@clisbot/plugin/client/host";
import React, { type ReactNode } from "react";
import type { InstalledPlugin } from "./types";

/** Every plugin surface renders under its installation: one query cache, one Clisbot client, RPCs. */
export function PluginInstallationProvider({
  plugin,
  children,
}: {
  plugin: InstalledPlugin;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={plugin.queryClient}>
      <ClisbotApiProvider clisbot={plugin.clisbot}>
        <PluginRpcProvider invoke={plugin.invoke}>
          <PluginTranslationProvider runtime={plugin.i18n}>{children}</PluginTranslationProvider>
        </PluginRpcProvider>
      </ClisbotApiProvider>
    </QueryClientProvider>
  );
}
