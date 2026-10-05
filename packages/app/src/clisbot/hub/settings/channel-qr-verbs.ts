import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useHubAccount } from "../account-provider";
import { hubResourceQueryKey } from "../query-keys";
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

/**
 * The Hub restarts an account in the background once its login links
 * (`supervisor.qrLogin`); its status leaves `needs-login` a few seconds later,
 * so it is read again over that window rather than once.
 */
const STATUS_REFRESH_AFTER_LINK_MS = [1_500, 5_000, 12_000];

export function useChannelQrVerbs(target: ChannelQrTarget): ChannelQrVerbs {
  const hub = useHubAccount();
  const queryClient = useQueryClient();
  const { channel, accountId } = target;
  return useMemo<ChannelQrVerbs>(() => {
    const statusKey = hubResourceQueryKey(
      {
        origin: hub.origin,
        organizationId: hub.signedIn?.organization.id ?? "",
        accountId: hub.signedIn?.account.id ?? null,
      },
      "channel-accounts",
    );
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
      linked: () => {
        for (const delay of STATUS_REFRESH_AFTER_LINK_MS) {
          setTimeout(() => void queryClient.invalidateQueries({ queryKey: statusKey }), delay);
        }
      },
    };
  }, [accountId, channel, hub, queryClient]);
}
