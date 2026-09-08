// Fusion-owned tool registration adapter (D-ZU-017).
//
// Upstream registers the `zalouser` agent tool through the OpenClaw plugin
// host: `extensions/zalouser/index.ts` hands `registerFull(api)` an
// `OpenClawPluginApi` whose `registerTool` accepts a tool or a per-execution
// factory (2026-09-06 channel-tools audit §6). Reading only the channel plugin
// object would miss that registration path entirely.
//
// Fusion has no plugin host, so this module exposes the same two surfaces the
// Feishu vertical does (`packages/channels/feishu/src/fusion/tools.ts`), over
// the same registrar shape:
//
//   * `zalouserAgentTools` — the flat factory list, for a caller that wants the
//     catalog;
//   * `registerZalouserTools(registrar)` — the adapter the Hub tool slice
//     calls.
//
// The tool itself — its name, schema, description, executor and result shapes —
// is the ported `tool.ts`, untouched. It is a per-execution FACTORY because
// upstream's `createZalouserTool(context)` binds the delivery context: the
// ambient thread the agent is answering in comes from that context, so a cached
// tool instance would send to the wrong conversation.

import { createZalouserTool } from "../tool.js";
import type {
  AnyAgentTool,
  OpenClawPluginToolContext,
  OpenClawPluginToolFactory,
  OpenClawPluginToolOptions,
} from "../runtime-api.js";

/** One registration as upstream's `api.registerTool` receives it. */
export interface ZalouserToolRegistration {
  tool: AnyAgentTool | OpenClawPluginToolFactory;
  options?: OpenClawPluginToolOptions;
}

/** The Fusion-side sink. The Hub tool slice implements it over its catalog. */
export interface ZalouserToolRegistrar {
  registerTool(
    tool: AnyAgentTool | OpenClawPluginToolFactory,
    options?: OpenClawPluginToolOptions,
  ): void;
}

/** The tool name this vertical registers (`openclaw.plugin.json` contracts). */
export const ZALOUSER_TOOL_NAMES = ["zalouser"] as const;

/** The per-execution factory, shaped like upstream's `ChannelPlugin.agentTools`. */
export const zalouserAgentTools: OpenClawPluginToolFactory[] = [
  (context: OpenClawPluginToolContext) => createZalouserTool(context),
];

/** Collects what the vertical would register. Nothing is executed: a factory
 * only runs when the tool is called. */
export function collectZalouserToolRegistrations(): ZalouserToolRegistration[] {
  return zalouserAgentTools.map((tool) => ({ tool }));
}

/** The Fusion-owned adapter: forwards every registration to the Hub registrar. */
export function registerZalouserTools(
  registrar: ZalouserToolRegistrar,
): ZalouserToolRegistration[] {
  const registrations = collectZalouserToolRegistrations();
  for (const entry of registrations) registrar.registerTool(entry.tool, entry.options);
  return registrations;
}
