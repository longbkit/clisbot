/** Bound automatic queue retry and deferral across restarts. */
export const CHANNEL_INGRESS_MAX_AGE_MS = 10 * 60_000;

/** Allows the sequential workspace/create/send RPCs, each with its own deadline. */
export const CHANNEL_INGRESS_DISPATCH_TIMEOUT_MS = 5 * 60_000;
