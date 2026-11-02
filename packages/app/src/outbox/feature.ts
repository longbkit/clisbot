/**
 * Instant send: a pressed message shows at once and stays in place until its Host accepts it,
 * with Retry when it fails (docs/timeline-sync.md#instant-send). Set
 * `EXPO_PUBLIC_CLISBOT_INSTANT_SEND=0` to wait for the Host and restore the draft on failure.
 */
export const INSTANT_SEND_ENABLED = process.env.EXPO_PUBLIC_CLISBOT_INSTANT_SEND !== "0";
