// Fusion-owned tool registration adapter (D-FS-018).
//
// Upstream registers the six `feishu_*` tool families through the OpenClaw
// plugin host: `extensions/feishu/index.ts` declares `registerFull(api)`, and
// the host hands it an `OpenClawPluginApi` whose `registerTool` accepts either a
// tool or a per-execution factory (`src/plugins/tools.ts`). Reading only the
// channel plugin object would miss this second registration path entirely
// (2026-09-06 channel-tools audit §6).
//
// Fusion has no plugin host, so this module builds the small slice of that API
// the six `register*Tools` entry points actually touch (config, logger,
// registerTool) over a Fusion registrar. The tool factories, their schemas,
// descriptions, executors, account gating and result shapes are the ported
// source's, untouched.
//
// Two surfaces come out of it:
//
//   * `feishuAgentTools` — the flat list of factories, shaped like upstream's
//     `ChannelPlugin.agentTools`, for a caller that wants the catalog.
//   * `registerFeishuTools(registrar)` — the Fusion-owned adapter the Hub tool
//     slice calls; it forwards each factory with its registration options.
//
// Authorization is NOT decided here. A factory receives the Hub's tool context
// (`OpenClawPluginToolContext`) and re-resolves the account, the enabled tool
// families and the resource permissions on every execution, which is upstream's
// rule: a cached catalog never grants access.
import { registerFeishuBitableTools } from "../bitable.js";
import { registerFeishuChatTools } from "../chat.js";
import { registerFeishuDocTools } from "../docx.js";
import { registerFeishuDriveTools } from "../drive.js";
import { registerFeishuPermTools } from "../perm.js";
import { registerFeishuWikiTools } from "../wiki.js";
import type {
  AnyAgentTool,
  OpenClawConfig,
  OpenClawPluginApi,
  OpenClawPluginToolFactory,
  OpenClawPluginToolOptions,
  PluginLogger,
} from "./runtime-api.js";

/** One registration as upstream's `api.registerTool` receives it. */
export interface FeishuToolRegistration {
  tool: AnyAgentTool | OpenClawPluginToolFactory;
  options?: OpenClawPluginToolOptions;
}

/** The Fusion-side sink. The Hub tool slice implements it over its catalog. */
export interface FeishuToolRegistrar {
  registerTool(
    tool: AnyAgentTool | OpenClawPluginToolFactory,
    options?: OpenClawPluginToolOptions,
  ): void;
}

/** The six entry points upstream's `registerFull` calls, in its order. */
const TOOL_FAMILY_REGISTRARS = [
  registerFeishuDocTools,
  registerFeishuChatTools,
  registerFeishuWikiTools,
  registerFeishuDriveTools,
  registerFeishuPermTools,
  registerFeishuBitableTools,
] as const;

/**
 * The tool names the six families can register, from
 * `extensions/feishu/openclaw.plugin.json`'s `contracts.tools`. A family that is
 * disabled for every account registers none of them, which is why the list is a
 * declaration and `collectFeishuToolRegistrations` is the truth for one config.
 */
export const FEISHU_TOOL_NAMES = [
  "feishu_app_scopes",
  "feishu_bitable_create_app",
  "feishu_bitable_create_field",
  "feishu_bitable_create_record",
  "feishu_bitable_get_meta",
  "feishu_bitable_get_record",
  "feishu_bitable_list_fields",
  "feishu_bitable_list_records",
  "feishu_bitable_update_record",
  "feishu_chat",
  "feishu_doc",
  "feishu_drive",
  "feishu_perm",
  "feishu_wiki",
] as const;

const noopLogger: PluginLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Runs the six ported entry points against one config and collects what they
 * registered. Nothing is executed: a factory only runs when the tool is called.
 */
export function collectFeishuToolRegistrations(params: {
  cfg: OpenClawConfig;
  logger?: PluginLogger;
}): FeishuToolRegistration[] {
  const registrations: FeishuToolRegistration[] = [];
  const api: OpenClawPluginApi = {
    config: params.cfg,
    logger: params.logger ?? noopLogger,
    registerTool: (tool, options) => {
      registrations.push(options === undefined ? { tool } : { tool, options });
    },
  };
  for (const register of TOOL_FAMILY_REGISTRARS) register(api);
  return registrations;
}

/** The Fusion-owned adapter: forwards every registration to the Hub registrar. */
export function registerFeishuTools(
  registrar: FeishuToolRegistrar,
  params: { cfg: OpenClawConfig; logger?: PluginLogger },
): FeishuToolRegistration[] {
  const registrations = collectFeishuToolRegistrations(params);
  for (const entry of registrations) registrar.registerTool(entry.tool, entry.options);
  return registrations;
}
