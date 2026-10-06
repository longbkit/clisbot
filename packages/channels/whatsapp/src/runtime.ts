// upstream: extensions/whatsapp/src/runtime.ts@3928bad9bad
// Whatsapp plugin module implements runtime behavior.
import type { PluginRuntime } from "./fusion/plugin-runtime.js";
import { createPluginRuntimeStore } from "./fusion/plugin-runtime.js";

const runtimeStore = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "whatsapp",
  errorMessage: "WhatsApp runtime not initialized",
});
const channelRuntimeStore = createPluginRuntimeStore<PluginRuntime["channel"]>({
  key: "plugin-runtime:whatsapp:channel-context-owner",
  errorMessage: "WhatsApp channel runtime not initialized",
});

/** Injects current helpers while preserving the process-lifetime channel context owner. */
function setWhatsAppRuntime(next: PluginRuntime): void {
  // Plugin registry reloads create fresh runtime objects. Live connection leases must remain
  // readable by outbound sends until their account task explicitly disposes them.
  if (!channelRuntimeStore.tryGetRuntime()) {
    channelRuntimeStore.setRuntime(next.channel);
  }
  runtimeStore.setRuntime(next);
}

const getWhatsAppRuntime = runtimeStore.getRuntime;
const getOptionalWhatsAppRuntime = runtimeStore.tryGetRuntime;
const getWhatsAppChannelRuntime = channelRuntimeStore.getRuntime;
const getOptionalWhatsAppChannelRuntime = channelRuntimeStore.tryGetRuntime;

export {
  getOptionalWhatsAppChannelRuntime,
  getOptionalWhatsAppRuntime,
  getWhatsAppChannelRuntime,
  getWhatsAppRuntime,
  setWhatsAppRuntime,
};
