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

/** Equal for two snapshots that differ only in Route default Agent controls. */
export function revisionSignature(
  snapshot: Pick<ChannelControlPlaneSnapshot, "files" | "controlPlane">,
): string {
  const resource = snapshot.files.find(({ path }) => path === HUB_RESOURCE_PATH)?.content ?? "";
  return createHash("sha256")
    .update(JSON.stringify([withoutAgentControls(snapshot.controlPlane), resource]))
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
  const fallback = account.fallback;
  return {
    ...account,
    defaults: stripped(account.defaults),
    routes: account.routes.map((route) => ({ ...route, defaults: stripped(route.defaults) })),
    fallback:
      fallback.defaults === undefined
        ? fallback
        : { ...fallback, defaults: stripped(fallback.defaults) },
  };
}

function stripped(defaults: EffectiveDefaults): EffectiveDefaults {
  const { agentControls: _controls, ...rest } = defaults;
  return rest;
}
