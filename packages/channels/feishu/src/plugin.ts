// The drive surface (blueprint §6.5 hard rule 2, B3-immutable): the pinned
// export name `feishuPlugin` carrying `gateway.startAccount` +
// `outbound.sendText`. The Hub loader imports this chunk and drives it.
//
// Beyond the members the Hub reads, `outbound` exposes the ported Lark send
// primitives by their upstream names so the message-action runner can dispatch
// without re-deriving a send path, and `agentTools` carries the six `feishu_*`
// tool families the way upstream's `ChannelPlugin.agentTools` does.

import type { ChannelPlugin, HostRuntime } from "@getpaseo/channels-shared";
import { feishuChannelActions } from "./channel-actions.js";
import { disposeFeishuRuntime } from "./fusion/runtime.js";
import {
  collectFeishuToolRegistrations,
  registerFeishuTools,
  FEISHU_TOOL_NAMES,
} from "./fusion/tools.js";
import { startFeishuAccount } from "./lifecycle/start-account.js";
import { sendCard, sendText, updateText } from "./outbound.js";
import { getHostRuntime } from "./runtime-store.js";
import { createPinFeishu, listPinsFeishu, removePinFeishu } from "./pins.js";
import { addReactionFeishu, listReactionsFeishu, removeReactionFeishu } from "./reactions.js";
import { editMessageFeishu, getMessageFeishu, sendCardFeishu, sendMessageFeishu } from "./send.js";
import { probeFeishu } from "./probe.js";

export const feishuPlugin: ChannelPlugin = {
  /** Message-tool discovery, schema contributions and the native
   * `handleAction` dispatcher. */
  actions: feishuChannelActions,
  messageActions: feishuChannelActions,
  gateway: {
    startAccount: (ctx) =>
      startFeishuAccount(ctx, (ctx["hostRuntime"] as HostRuntime | undefined) ?? getHostRuntime()),
  },
  /** The Hub's loader calls this when it unloads this account's vertical: it
   * releases the account's ported plugin runtime (keyed stores, media dir, log
   * sink). */
  disposeAccount: (accountId: string) => {
    disposeFeishuRuntime(accountId);
  },
  /** The six `feishu_*` tool families. Upstream registers them through the
   * plugin host's `registerFull(api)`; `fusion/tools.ts` is the Fusion-owned
   * adapter over the same entry points (see HUB-WIRING.md). */
  agentTools: {
    names: FEISHU_TOOL_NAMES,
    collect: collectFeishuToolRegistrations,
    registerTools: registerFeishuTools,
  },
  outbound: {
    sendText,
    // COMPAT(clisbot-control-plane): the approval/progress card's in-place update.
    updateText,
    sendCard,
    // The ported Lark primitives, by their upstream names.
    sendMessageFeishu,
    sendCardFeishu,
    editMessageFeishu,
    getMessageFeishu,
    addReactionFeishu,
    removeReactionFeishu,
    listReactionsFeishu,
    createPinFeishu,
    removePinFeishu,
    listPinsFeishu,
    probeFeishu,
  },
};

export { startFeishuAccount } from "./lifecycle/start-account.js";
export { sendCard, sendText, updateText } from "./outbound.js";
