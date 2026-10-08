import type { AgentToolGroup, AgentToolInfo } from "@clisbot/protocol/connectors/agent-tools";
import { i18n } from "@/i18n/i18next";

/**
 * The Clisbot agent tools' copy in the app's language. The protocol keeps the English, shared with
 * the daemon; `connectors.tools.catalog` translates it by group id and tool name. A group or tool
 * the catalog does not know yet shows its protocol English.
 */

/** A group id or tool name as a catalog key: anything but letters, digits and `_` becomes `_`. */
export function agentToolCatalogKey(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

export function agentToolGroupLabel(group: Pick<AgentToolGroup, "id" | "label">): string {
  return i18n.t(`connectors.tools.catalog.groups.${agentToolCatalogKey(group.id)}.label`, {
    defaultValue: group.label,
  });
}

export function agentToolGroupDescription(
  group: Pick<AgentToolGroup, "id" | "description">,
): string {
  return i18n.t(`connectors.tools.catalog.groups.${agentToolCatalogKey(group.id)}.description`, {
    defaultValue: group.description,
  });
}

export function agentToolDescription(tool: AgentToolInfo): string {
  return i18n.t(`connectors.tools.catalog.tools.${agentToolCatalogKey(tool.name)}`, {
    defaultValue: tool.description,
  });
}
