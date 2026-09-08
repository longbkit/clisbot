// @getpaseo/channels-feishu — the in-repo Feishu/Lark channel vertical
// (goal ledger slice 15). Exports:
// - `default` — the bundled-channel entry (`id: "feishu"`);
// - `feishuPlugin` — the pinned drive-surface name (startAccount + sendText);
// - the six `feishu_*` tool families and their Fusion registrar;
// - the layer modules for targeted tests.

export { default } from "./entry.js";
export { entry } from "./entry.js";
export { feishuPlugin, sendCard, sendText, startFeishuAccount, updateText } from "./plugin.js";
export { feishuChannelActions, FEISHU_MESSAGE_ACTIONS } from "./channel-actions.js";
export { messageActionTargetAliases } from "./message-action-contract.js";
export {
  collectFeishuToolRegistrations,
  registerFeishuTools,
  FEISHU_TOOL_NAMES,
  type FeishuToolRegistrar,
  type FeishuToolRegistration,
} from "./fusion/tools.js";
export { installFeishuRuntime, disposeFeishuRuntime } from "./fusion/runtime.js";
export {
  createFeishuAdmission,
  type FeishuAdmission,
  type FeishuAdmissionResult,
} from "./fusion/admission.js";
export {
  buildFeishuBotMemberEvent,
  buildFeishuCardActionEvent,
  buildFeishuInboundEvent,
  type FeishuInboundBuild,
  type FeishuInboundParams,
} from "./fusion/inbound-adapter.js";
export { startFeishuWsSession } from "./fusion/ws-session.js";
export {
  resolveFeishuConnectionMode,
  startFeishuWebhookSession,
} from "./fusion/webhook-session.js";
export { resolveFeishuDriveAccount, mergeAccountCarrier } from "./fusion/account-config.js";
export { setGuardedFetchImplementation } from "./fusion/ssrf-fetch.js";
export {
  setChannelHostRuntime,
  getHostRuntime,
  registerAccountInbound,
  unregisterAccountInbound,
} from "./runtime-store.js";
export {
  listFeishuAccountIds,
  listEnabledFeishuAccounts,
  resolveFeishuAccount,
  resolveDefaultFeishuAccountId,
} from "./accounts.js";
export { createFeishuClient, createEventDispatcher, createFeishuWSClient } from "./client.js";
export { probeFeishu } from "./probe.js";
export { monitorWebhook, monitorWebSocket } from "./monitor.transport.js";
export * from "./targets.js";
export type * from "./types.js";
