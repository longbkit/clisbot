import { AsyncLocalStorage } from "node:async_hooks";

/** Follow late continuations to the RPC/post boundary without changing the channel wire. */
export const ingressAttempt = new AsyncLocalStorage<AbortSignal>();

export const INGRESS_OUTCOME_UNKNOWN = "dispatch-outcome-unknown";

export class ChannelIngressDispatchInterruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelIngressDispatchInterruptedError";
  }
}
