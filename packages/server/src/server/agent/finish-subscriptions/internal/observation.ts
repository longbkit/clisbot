import type { Logger } from "pino";
import type { AgentManager } from "../../agent-manager.js";
import type { AgentStorage } from "../../agent-storage.js";
import type { AgentMessageDelivery } from "../../agent-messages/index.js";
import { buildStoredAgentPayload, toAgentPayload } from "../../agent-projections.js";
import { serializeSnapshotWithMetadata } from "../../mcp-shared.js";
import {
  createHostObservationResolver,
  HostOperationRejectedError,
  type ToolHosts,
} from "../../host-operations/index.js";
import { openFinishObservation } from "./observation-stream.js";
import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import type { AgentSnapshotPayload } from "@clisbot/protocol/messages";
import type { FinishObservation, FinishSubscription } from "../index.js";

export function createFinishObservation(input: {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  messages(): AgentMessageDelivery;
  hosts(): ToolHosts;
  canUseRemoteHosts?: () => boolean;
  onRemoteAuthorityChange?: (listener: () => void) => () => void;
  serverId: string;
  logger: Logger;
}): FinishObservation {
  const { agentManager, agentStorage } = input;
  const assertRemoteAuthority = () => {
    if (input.canUseRemoteHosts?.() === false)
      throw new HostOperationRejectedError(
        Object.assign(
          new Error(
            "Remote finish observation is blocked by current managed Host authority; its durable subscription is retained until destination actor and grant delegation is available",
          ),
          { code: "permission_denied" },
        ),
      );
  };
  const assertAuthority = (record: FinishSubscription) => {
    if (record.serverId && record.serverId !== input.serverId) assertRemoteAuthority();
  };
  const resolver = createHostObservationResolver({
    serverId: input.serverId,
    hosts: () => ({
      directory: () => {
        assertRemoteAuthority();
        return input.hosts().directory();
      },
      use: (serverId, action, signal) => {
        assertRemoteAuthority();
        return input.hosts().use(serverId, action, signal);
      },
    }),
    local: {
      async wait(agentId, signal) {
        await input.messages().waitForDispatch(agentId, signal);
        signal.throwIfAborted();
        const live = agentManager.getAgent(agentId);
        if (!live) {
          const stored = await agentStorage.get(agentId);
          return {
            status: stored?.lastStatus === "error" ? "error" : "idle",
            final: stored ? buildStoredAgentPayload(stored, [stored.provider]) : null,
            lastMessage: await agentManager.getLastAssistantMessage(agentId),
            error: stored?.lastError ?? null,
          };
        }
        const result = await agentManager.waitForAgentEvent(agentId, {
          signal,
          waitForActive: true,
        });
        const current = agentManager.getAgent(agentId);
        const status = result.permission ? "permission" : result.status;
        return {
          status: status === "permission" || status === "error" ? status : "idle",
          final: current
            ? await serializeSnapshotWithMetadata(agentStorage, current, input.logger)
            : null,
          lastMessage: result.lastMessage,
          error: current?.lastError ?? null,
        };
      },
      async observe(agentId, handler, signal, onError) {
        const stored = await agentStorage.get(agentId);
        let updates = Promise.resolve();
        const publish = (snapshot: AgentSnapshotPayload | null, event?: AgentStreamEvent) => {
          updates = updates
            .then(async () =>
              handler(snapshot, event, await agentManager.getLastAssistantMessage(agentId)),
            )
            .catch(onError);
        };
        signal.throwIfAborted();
        const unsubscribe = agentManager.subscribe(
          (event) => {
            if (event.type === "agent_state" && event.agent.lifecycle !== "idle")
              publish(toAgentPayload(event.agent, { title: stored?.title }));
            else if (
              event.type === "agent_stream" &&
              [
                "permission_requested",
                "permission_resolved",
                "turn_started",
                "turn_completed",
                "turn_canceled",
                "turn_failed",
              ].includes(event.event.type)
            ) {
              const current = agentManager.getAgent(agentId);
              if (current) publish(toAgentPayload(current, { title: stored?.title }), event.event);
            }
          },
          { agentId, replayState: false },
        );
        const current = agentManager.getAgent(agentId);
        if (current)
          publish(toAgentPayload(current, { title: stored?.title }), {
            type: "turn_started",
            provider: current.provider,
          });
        else publish(stored ? buildStoredAgentPayload(stored, [stored.provider]) : null);
        const stop = () => unsubscribe();
        signal.addEventListener("abort", stop, { once: true });
        return async () => {
          signal.removeEventListener("abort", stop);
          unsubscribe();
        };
      },
    },
  });
  return {
    assertAuthority,
    async open(record, signal) {
      assertAuthority(record);
      const controller = new AbortController();
      const lifetime = AbortSignal.any([signal, controller.signal]);
      const revoke = () => {
        try {
          assertAuthority(record);
        } catch (error) {
          controller.abort(error);
        }
      };
      const unsubscribe = input.onRemoteAuthorityChange?.(revoke) ?? (() => {});
      try {
        // Close the subscribe/open race and prevent output from an already open route
        // after management mode changes. Authorization loss is not host unavailability.
        assertAuthority(record);
        const observation = await openFinishObservation(resolver, record, lifetime);
        return {
          async next() {
            assertAuthority(record);
            const result = await observation.next();
            assertAuthority(record);
            return result;
          },
          async close() {
            unsubscribe();
            controller.abort();
            await observation.close();
          },
        };
      } catch (error) {
        unsubscribe();
        controller.abort();
        throw error;
      }
    },
  };
}
