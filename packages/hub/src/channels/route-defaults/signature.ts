// Whether a running account can adopt a newer revision in place. A Route
// default only decides what the next session starts, so a revision that
// differs from the running one in Route default Agent controls alone needs no
// transport restart. A restart cancels Route-owned turns and retires reply
// capabilities, which would turn one conversation's `/promoteroutedefault`
// into an interruption for every account.

import { createHash } from "node:crypto";
import { HUB_RESOURCE_PATH } from "../../config/bundle-contract.js";
import type { ChannelControlPlane, CompiledChannelAccount } from "../config/compile.js";
import type { EffectiveDefaults } from "../config/inheritance.js";
import type { ChannelControlPlaneSnapshot } from "../control-plane.js";

/**
 * Equal for two snapshots that differ only in Route default Agent controls.
 * With `account`, other accounts' configuration is left out as well: an account
 * restarts for its own changes and for what every account shares (roles, users,
 * org defaults, the Hub resource), never because a neighbour's Route was edited.
 */
export function revisionSignature(
  snapshot: Pick<ChannelControlPlaneSnapshot, "files" | "controlPlane">,
  account?: { channel: string; accountId: string },
): string {
  const resource = snapshot.files.find(({ path }) => path === HUB_RESOURCE_PATH)?.content ?? "";
  const controlPlane = withoutAgentControls(snapshot.controlPlane);
  const scoped =
    account === undefined
      ? controlPlane
      : {
          ...controlPlane,
          accounts: controlPlane.accounts.filter(
            (candidate) =>
              candidate.channel === account.channel && candidate.accountId === account.accountId,
          ),
        };
  return createHash("sha256")
    .update(JSON.stringify([scoped, resource]))
    .digest("base64url");
}

function withoutAgentControls(controlPlane: ChannelControlPlane): ChannelControlPlane {
  return {
    ...controlPlane,
    defaults: stripped(controlPlane.defaults),
    accounts: controlPlane.accounts.map(accountWithoutAgentControls),
  };
}

function accountWithoutAgentControls(account: CompiledChannelAccount): CompiledChannelAccount {
  return {
    ...account,
    defaults: stripped(account.defaults),
    routes: account.routes.map((route) => ({ ...route, defaults: stripped(route.defaults) })),
  };
}

function stripped(defaults: EffectiveDefaults): EffectiveDefaults {
  const { agentControls: _controls, ...rest } = defaults;
  return rest;
}
