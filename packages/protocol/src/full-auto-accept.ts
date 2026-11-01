/**
 * Full auto-accept is Clisbot's last Mode on every provider: the agent runs the provider's
 * no-prompt mode and the daemon approves any permission request the agent still raises.
 * It never answers a question. The daemon accepts this id in `set_agent_mode` and in a
 * create config once it advertises `server_info.features.fullAutoAccept`; it never lists
 * it among a provider's modes, so older apps keep seeing only the provider's own.
 */
export const FULL_AUTO_ACCEPT_MODE_ID = "full-auto-accept";
