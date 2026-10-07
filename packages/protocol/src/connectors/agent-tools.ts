import { z } from "zod";

/**
 * The daemon's own tools an agent may get (docs/features/connectors/README.md, "Agent tools"):
 * the Clisbot tools in groups, the browser first. One table for the app's lists and the
 * daemon's per-session switches; a server test fails when a registered tool is missing here.
 * The descriptions are for the person choosing, not the agent-facing ones.
 */

export interface AgentToolInfo {
  name: string;
  description: string;
}

export interface AgentToolGroup {
  id: string;
  label: string;
  description: string;
  tools: readonly AgentToolInfo[];
}

const t = (name: string, description: string): AgentToolInfo => ({ name, description });

export const AGENT_TOOL_GROUPS: readonly AgentToolGroup[] = [
  {
    id: "browser",
    label: "Browser",
    description: "Drive the built-in browser: open pages, click, type, read and capture",
    tools: [
      t("browser_list_tabs", "List open tabs"),
      t("browser_new_tab", "Open a tab"),
      t("browser_navigate", "Go to a page"),
      t("browser_back", "Go back a page"),
      t("browser_forward", "Go forward a page"),
      t("browser_reload", "Reload a page"),
      t("browser_snapshot", "Read a page's content"),
      t("browser_screenshot", "Capture a page"),
      t("browser_click", "Click an element"),
      t("browser_hover", "Point at an element"),
      t("browser_fill", "Fill a field"),
      t("browser_type", "Type text"),
      t("browser_keypress", "Press a key"),
      t("browser_select", "Choose an option"),
      t("browser_upload", "Upload a file"),
      t("browser_drag", "Drag an element"),
      t("browser_scroll", "Scroll a page"),
      t("browser_wait", "Wait for a page to change"),
      t("browser_evaluate", "Run script in a page"),
      t("browser_logs", "Read a page's console"),
      t("browser_resize", "Resize the browser"),
      t("browser_close_tab", "Close a tab"),
    ],
  },
  {
    id: "agents",
    label: "Agents",
    description: "Start other agents, give them work and follow them",
    tools: [
      t("create_agent", "Start a new agent with a prompt"),
      t("send_agent_prompt", "Send a message to another agent"),
      t("get_agent_status", "Read an agent's state"),
      t("get_agent_activity", "Read what an agent did recently"),
      t("list_agents", "List the agents on this Host"),
      t("update_agent", "Rename an agent or change its labels"),
      t("set_agent_mode", "Change an agent's permission mode"),
      t("cancel_agent", "Stop an agent's current turn"),
      t("archive_agent", "Archive an agent"),
      t("kill_agent", "End an agent's session"),
    ],
  },
  {
    id: "permissions",
    label: "Permissions",
    description: "See and answer other agents' permission requests",
    tools: [
      t("list_pending_permissions", "List permission requests waiting for an answer"),
      t("respond_to_permission", "Answer another agent's permission request"),
    ],
  },
  {
    id: "workspaces",
    label: "Workspaces",
    description: "Create and manage workspaces and their scripts",
    tools: [
      t("create_workspace", "Create a workspace or worktree"),
      t("list_workspaces", "List workspaces"),
      t("rename_workspace", "Rename a workspace"),
      t("archive_workspace", "Archive a workspace"),
      t("list_workspace_scripts", "List a workspace's scripts"),
      t("start_workspace_script", "Run a workspace script"),
      t("stop_workspace_script", "Stop a running workspace script"),
    ],
  },
  {
    id: "terminals",
    label: "Terminals",
    description: "Open terminals, type into them and read their output",
    tools: [
      t("create_terminal", "Open a terminal"),
      t("list_terminals", "List terminals"),
      t("send_terminal_keys", "Type into a terminal"),
      t("capture_terminal", "Read a terminal's output"),
      t("kill_terminal", "Close a terminal"),
    ],
  },
  {
    id: "schedules",
    label: "Schedules",
    description: "Create and run Automations and heartbeats",
    tools: [
      t("create_schedule", "Create a scheduled task"),
      t("list_schedules", "List scheduled tasks"),
      t("inspect_schedule", "Read a scheduled task"),
      t("update_schedule", "Change a scheduled task"),
      t("pause_schedule", "Pause a scheduled task"),
      t("resume_schedule", "Resume a scheduled task"),
      t("run_schedule_once", "Run a scheduled task now"),
      t("schedule_logs", "Read a scheduled task's runs"),
      t("delete_schedule", "Delete a scheduled task"),
      t("create_heartbeat", "Wake this agent on a schedule"),
      t("delete_heartbeat", "Stop a heartbeat"),
    ],
  },
  {
    id: "providers",
    label: "Providers",
    description: "Read which providers, models and profiles this Host has",
    tools: [
      t("list_providers", "List agent providers"),
      t("list_models", "List a provider's models"),
      t("list_profiles", "List agent profiles"),
      t("inspect_provider", "Read a provider's settings"),
    ],
  },
];

/** The group the browser tools are in; it also has its own Host switch and Project choice. */
export const BROWSER_TOOL_GROUP = "browser";

/** Tools every agent keeps whatever is chosen: `speak` answers in voice chats. */
export const ALWAYS_ON_AGENT_TOOLS: readonly string[] = ["speak"];

export function agentToolGroupOf(tool: string): AgentToolGroup | undefined {
  return AGENT_TOOL_GROUPS.find((group) => group.tools.some((entry) => entry.name === tool));
}

/** The key a session's off list (`clisbot.connectors-off`) uses for a whole group of agent tools. */
export function agentToolGroupOffKey(group: string): string {
  return `tools:${group}`;
}

/** The key a session's off list uses for one agent tool. */
export function agentToolOffKey(tool: string): string {
  return `tool:${tool}`;
}

/**
 * A Project's choice for the daemon's tools; unset follows the Host (its "Inject Clisbot tools" and
 * "Browser tools" settings). `disabledTools` takes tools away from what is on.
 */
export const AgentToolsGrantSchema = z.object({
  enabled: z.boolean().optional(),
  disabledTools: z.array(z.string()).optional(),
});
export type AgentToolsGrant = z.infer<typeof AgentToolsGrantSchema>;
