import { useClisbot, useRpc } from "@clisbot/plugin/client";
import { defineRpc } from "@clisbot/plugin";
import type { ClisbotApi } from "@clisbot/client";
import { QueryClient } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { z } from "zod";
import { PluginInstallationProvider } from "./installation-provider";
import type { InstalledPlugin } from "./types";

const status = defineRpc({
  name: "deploys.status",
  input: z.object({}),
  output: z.object({ state: z.string() }),
});

function installation(invoked: string[]): InstalledPlugin {
  return {
    id: "deploys",
    serverId: "host",
    clientBundle: "",
    lifetime: new AbortController(),
    clisbot: { dispose: async () => undefined } as ClisbotApi,
    invoke: async (method) => {
      invoked.push(method);
      return { state: "green" };
    },
    queryClient: new QueryClient(),
    cleanup: () => undefined,
    settingsScreens: [],
    surfaces: [],
    sidebarItems: { header: [], footer: [] },
    legacySidebarItems: [],
    workspacePanels: [],
    commandCenterItems: [],
    clientSlashCommands: [],
    attachmentSources: [],
    themes: [],
    timelineTransformers: [],
    timelineRenderers: [],
  };
}

it("gives every surface the installation's client and RPCs on its first frame", async () => {
  const invoked: string[] = [];
  const plugin = installation(invoked);
  const received: ClisbotApi[] = [];
  let rpc: ((input: Record<string, never>) => Promise<unknown>) | null = null;
  function Surface({ name }: { name: string }) {
    received.push(useClisbot());
    rpc = useRpc(status);
    return <span>{name}</span>;
  }

  const markup = ["Screen", "Sidebar item", "Popover"]
    .map((name) =>
      renderToStaticMarkup(
        <PluginInstallationProvider plugin={plugin}>
          <Surface name={name} />
        </PluginInstallationProvider>,
      ),
    )
    .join("");

  expect(markup).toBe("<span>Screen</span><span>Sidebar item</span><span>Popover</span>");
  expect(received).toEqual([plugin.clisbot, plugin.clisbot, plugin.clisbot]);
  expect(received.every((clisbot) => clisbot === plugin.clisbot)).toBe(true);
  await expect(rpc!({})).resolves.toEqual({ state: "green" });
  expect(invoked).toEqual(["deploys.status"]);
});
