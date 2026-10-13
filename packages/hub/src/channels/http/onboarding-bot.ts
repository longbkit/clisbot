import { conflict } from "./problems.js";
import { BotListResponseSchema } from "@clisbot/protocol/bots/rpc-schemas";
import type { DaemonSessionAccess } from "../../daemons/protocol.js";
import { EnrolledDaemonClient } from "../daemon/enrolled-client.js";

/** Read the Bot through its enrolled Host's existing session, never a caller-supplied owner. */
export function onboardingBotReader(sessions: () => DaemonSessionAccess | undefined) {
  return async (daemonId: string, botId: string) => {
    const access = sessions();
    if (!access?.channel(daemonId)) throw conflict("Bot Host is offline; reconnect it and retry.");
    const client = new EnrolledDaemonClient({
      resolveChannel: () => access.channel(daemonId),
      subscribe: (handler) => access.subscribe(daemonId, handler),
      onHostDisconnected: (handler) =>
        access.onDisconnected((id) => {
          if (id === daemonId) handler();
        }),
      rpcTimeoutMs: 5000,
    });
    client.connect();
    try {
      const result = BotListResponseSchema.shape.payload.parse(
        await client.call("bot.list.request", {}),
      );
      if (result.error)
        throw conflict(
          "This Host could not verify the Bot Owner. Check its Bot capability and granted Hub read access, then retry.",
        );
      return result.bots.find((bot) => bot.id === botId);
    } catch {
      throw conflict(
        "The Bot Host could not verify ownership. Reconnect it and check its Bot capability and granted Hub read access, then retry.",
      );
    } finally {
      client.stop();
    }
  };
}
