// Fusion-owned replacement for the extension's private runtime barrel
// `extensions/zalouser/runtime-api.ts` (D-ZU-001).
//
// Upstream's barrel re-exports ~40 members of `openclaw/plugin-sdk/*` — the
// setup wizard, the pairing controller, the reply pipeline, the config
// contracts and the plugin runtime setter — so a bundled plugin can be loaded
// by an OpenClaw host without importing `openclaw` itself. Fusion has no
// OpenClaw host: the members this vertical's ported closure reads come from
// `@getpaseo/channels-core`, which carries the same upstream source modules,
// and the Hub owns the rest (setup, pairing, reply delivery, session keys).
//
// Import specifiers are the only thing the ported files change: every ported
// `import … from "../runtime-api.js"` was rewritten to this module.

export type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
export type { ChannelGroupContext } from "@getpaseo/channels-core/plugin-sdk/channel-contract";
import type { AnyAgentTool as CoreAnyAgentTool } from "@getpaseo/channels-core/agents/tools/common.host-adapter";

/** D-ZU-021: the core host adapter also makes `execute` optional (it types a
 * tool the same way it types a factory's partial). Upstream's `AnyAgentTool`
 * requires it, and the ported `tool.ts` and its test both rely on that, so the
 * barrel restores upstream's shape here rather than editing the ported files. */
export type AnyAgentTool = CoreAnyAgentTool & {
  execute: NonNullable<CoreAnyAgentTool["execute"]>;
};
export type {
  OpenClawPluginApi,
  OpenClawPluginToolFactory,
  OpenClawPluginToolOptions,
  PluginLogger,
} from "@getpaseo/channels-core/plugin-sdk/plugin-entry";

import type { OpenClawPluginToolContext as CoreToolContext } from "@getpaseo/channels-core/plugin-sdk/plugin-entry";
import type { OpenClawConfig as ToolRuntimeConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";

/** D-ZU-021: `@getpaseo/channels-core` carries the tool context as a host
 * adapter that narrows away upstream's two runtime-config readers. The ported
 * `tool.ts` prefers them (`getRuntimeConfig()` over `runtimeConfig` over
 * `config`) so a media ceiling changed mid-session is honoured, so the barrel
 * restores upstream's spelling here rather than editing the ported file. */
export type OpenClawPluginToolContext = CoreToolContext & {
  runtimeConfig?: ToolRuntimeConfig;
  getRuntimeConfig?: () => ToolRuntimeConfig;
};

/** The runtime env a channel account's monitor receives (upstream's text). */
export type RuntimeEnv = {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  exit: (code: number) => void;
};
