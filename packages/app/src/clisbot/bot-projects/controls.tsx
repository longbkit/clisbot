import type { ReactNode } from "react";
import { BotsSectionHeader } from "@/clisbot/bots/sidebar/section-header";
import { useBotProjectsPreference } from "./preferences";

/** Compatibility export for old extension consumers: visibility is now a section, not a filter. */
export function BotProjectsToggle(_props: { menu?: boolean }) {
  return null;
}
export function BotProjectsGroup({ children }: { children: ReactNode }) {
  const collapsed = useBotProjectsPreference((state) => state.botProjectsCollapsed);
  const toggle = useBotProjectsPreference((state) => state.toggleBotProjectsCollapsed);
  return (
    <>
      <BotsSectionHeader
        label="Bot projects"
        testID="sidebar-bot-projects-group"
        collapsed={collapsed}
        onToggle={toggle}
      />
      {collapsed ? null : children}
    </>
  );
}
