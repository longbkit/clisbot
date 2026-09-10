// Fusion-internal build-time code reuse, NOT a wire contract. The daemon (Gate
// B) and the Hub channel path each enforce with their own copy; this module is
// the single source they share so a channel action and the app action that send
// the same wire RPC cannot drift on the product privilege they require.
//
// Keep this pure — no zod, no runtime wire parsing. It carries the product
// `ProjectPrivilege` vocabulary (so there is ONE definition) and the overlap
// map from wire operation to the privilege that operation needs.

/** The project-scoped product privileges a managed session can hold. */
export const PROJECT_PRIVILEGES = [
  "project.use",
  "workspace.create",
  "agent.interact",
  "agent.create",
  "agent.fast.use",
  "terminal.use",
  "approval.file",
  "approval.config",
  "approval.command",
  "approval.command.destructive",
  "approval.channel",
] as const;
export type ProjectPrivilege = (typeof PROJECT_PRIVILEGES)[number];

/**
 * The overlap only: wire operations (message `type`) that become daemon RPCs a
 * channel action and an app action both send, mapped to the product privilege
 * each requires. Not a superset of every daemon op — daemon-only authority
 * (workspace lifecycle, pairing, file paths, `daemon.read`/`daemon.manage`
 * classes) and channel-only authority (`channel.use`, conversation scope,
 * reply/outbound, `/link`, `approval.channel`) stay in their own surfaces.
 */
export const REQUIRED_PRIVILEGE_BY_OPERATION = {
  create_agent_request: "agent.create",
  send_agent_message_request: "agent.interact",
  cancel_agent_request: "agent.interact",
  refresh_agent_request: "agent.interact",
  delete_agent_request: "agent.interact",
  archive_agent_request: "agent.interact",
  update_agent_request: "agent.interact",
  clear_agent_attention: "agent.interact",
  "agent.detach.request": "agent.interact",
  "agent.rewind.request": "agent.interact",
  set_agent_mode_request: "agent.interact",
  set_agent_model_request: "agent.interact",
  set_agent_thinking_request: "agent.interact",
  set_agent_feature_request: "agent.interact",
  "agent.config.apply.request": "agent.interact",
  set_voice_mode: "agent.interact",
  list_terminals_request: "terminal.use",
  subscribe_terminals_request: "terminal.use",
  unsubscribe_terminals_request: "terminal.use",
  create_terminal_request: "terminal.use",
  subscribe_terminal_request: "terminal.use",
  unsubscribe_terminal_request: "terminal.use",
  terminal_input: "terminal.use",
  kill_terminal_request: "terminal.use",
  capture_terminal_request: "terminal.use",
  "terminal.rename.request": "terminal.use",
} as const satisfies Record<string, ProjectPrivilege>;

/** The privilege a wire operation requires, or undefined when it is not an overlap op. */
export function requiredPrivilegeForOperation(type: string): ProjectPrivilege | undefined {
  return (REQUIRED_PRIVILEGE_BY_OPERATION as Record<string, ProjectPrivilege>)[type];
}
