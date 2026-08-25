import type { SlackProviderApplicationConfiguration } from "../../../provider-applications/index.js";
import type { TriggerSource } from "../../index.js";
import { createSlackWebhookSource } from "../webhook.js";
import type { SlackEventIntakeOptions } from "./internal/intake.js";
import {
  createSlackSocketSource,
  type SlackDeliveryStatus,
  type SlackSocketSourceOptions,
} from "./internal/socket.js";

export interface SlackEventSource extends TriggerSource {
  request?: (request: Request) => Promise<Response>;
  status(): SlackDeliveryStatus;
  retry(): Promise<void>;
}

export interface CreateSlackEventSourceOptions {
  configuration: SlackProviderApplicationConfiguration;
  accept: SlackEventIntakeOptions["accept"];
  socket?: Pick<SlackSocketSourceOptions, "apiUrl" | "random" | "timeoutMs">;
}

export function createSlackEventSource(options: CreateSlackEventSourceOptions): SlackEventSource {
  if (options.configuration.transport === "webhook") {
    const webhook = createSlackWebhookSource({
      appId: options.configuration.appId,
      signingSecret: options.configuration.signingSecret,
      accept: (input) => options.accept(input),
    });
    return {
      start: (handler) => webhook.start(handler),
      stop: () => webhook.stop(),
      request: (request) => webhook.handle(request),
      status: () => ({ state: "stopped" }),
      retry: () => Promise.resolve(),
    };
  }
  const socket = createSlackSocketSource({
    appId: options.configuration.appId,
    appToken: options.configuration.appToken,
    accept: (input) => options.accept(input),
    ...options.socket,
  });
  return socket;
}

export type { SlackDeliveryStatus } from "./internal/socket.js";
