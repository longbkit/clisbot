import { useMemo } from "react";
import { useHubAccount } from "../account-provider";
import {
  cancelChannelQrLogin,
  logoutChannelQrLogin,
  pollChannelQrLogin,
  startChannelQrLogin,
  type ChannelQrTarget,
} from "../channel-api";
import type { ChannelQrVerbs } from "./channel-qr-link-panel";

/**
 * The Hub has served the QR operations since slice 17b. A Hub older than that
 * answers every verb with the management API's unknown-route 404, which
 * `channelQrFailure` settles as the panel's terminal `unavailable` phase — so
 * this stays `true` and the runtime answer is what decides.
 */
export const CHANNEL_QR_OPERATIONS_AVAILABLE = true;

export function useChannelQrVerbs(target: ChannelQrTarget): ChannelQrVerbs {
  const hub = useHubAccount();
  const { channel, accountId } = target;
  return useMemo<ChannelQrVerbs>(() => {
    const qr = { channel, accountId };
    return {
      start: ({ relink }) => startChannelQrLogin(hub.api(), qr, { relink }),
      poll: async () => {
        // The wire leaves `displayName` optional; the model wants it explicit.
        const result = await pollChannelQrLogin(hub.api(), qr);
        const user = result.user;
        return {
          status: result.status,
          message: result.message,
          ...(user === undefined
            ? {}
            : { user: { userId: user.userId, displayName: user.displayName ?? null } }),
        };
      },
      cancel: () => cancelChannelQrLogin(hub.api(), qr),
      logout: () => logoutChannelQrLogin(hub.api(), qr),
    };
  }, [accountId, channel, hub]);
}
