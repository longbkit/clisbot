import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@clisbot/plugin/client";
import { SidebarRow } from "@clisbot/plugin/client/ui";
import { Hosts } from "./client/hosts";

function HostsItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: "main" }), [openScreen]);
  return <SidebarRow icon="Server" active={currentScreen?.screenId === "main"} onPress={open} />;
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "main", title: "Host agents", Component: Hosts });
  client.addSidebarHeaderItem({ id: "hosts", title: "Host agents", Component: HostsItem });
  return () => {};
}
