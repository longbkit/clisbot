// L4 account lifecycle (blueprint §6.5 L4, start-account.md): resolve the
// account and its credential profile, install the session store and hydrate it,
// probe the linked identity, register the L3 inbound processor, then hand off
// to the L2 listener session. The startAccount promise resolves only when
// `ctx.abortSignal` fires — "start" is the transport lifetime.
//
// Upstream's equivalent is `channel.runtime.ts`'s gateway trampoline plus
// `monitor.ts`'s `monitorZalouserProvider` prologue. Carried from them: the
// own-user-id resolution before any message is normalized (upstream computes it
// once and hands it to the ingress monitor), the ready status patch, and the
// listener-failure-fails-the-account rule. The OpenClaw pieces — the SQLite
// ingress queue, the allowlist name resolution against the friend/group
// directory, the pairing controller, the reply pipeline and the history window
// — are Hub-owned (D-ZU-020).
//
// ONE BEHAVIOUR CHANGE: an unlinked profile FAILS the start. Upstream lets the
// monitor come up and reports "not authenticated" through `doctor`; the Hub
// supervisor has no other place to learn the QR session is gone, and a
// silently-idle account is exactly the failure mode the operator would not see.

import type { HostRuntime, StartAccountContext } from "@getpaseo/channels-shared";
import { resolveZalouserDriveAccount } from "../fusion/account-config.js";
import { createZalouserAdmission } from "../fusion/admission.js";
import { startZalouserListenerSession } from "../fusion/listener-session.js";
import {
  createHostRuntimeSessionStore,
  hydrateZalouserSessions,
  installZalouserSessionStore,
} from "../fusion/session-store.js";
import { probeZalouser } from "../probe.js";
import { registerAccountInbound, unregisterAccountInbound } from "../runtime-store.js";
import { resolveZaloOwnUserId } from "../zalo-js.js";

/** `plugin.gateway.startAccount` — the drive surface entry. Resolves on abort. */
export async function startZalouserAccount(
  ctx: StartAccountContext,
  hostRuntime: HostRuntime,
): Promise<void> {
  const log = ctx.log;
  const { accountId, abortSignal } = ctx;
  if (ctx.cfg === undefined || ctx.cfg === null) {
    throw new Error("zalouser startAccount requires a runtime config (ctx.cfg)");
  }
  const account = resolveZalouserDriveAccount(ctx);
  const profile = account.profile.trim();
  if (profile === "") {
    throw new Error(`zalouser account "${accountId}" has no credential profile`);
  }

  // The session store must exist BEFORE anything reads credentials: every
  // `zalo-js.ts` entry point resolves the API from the stored session.
  installZalouserSessionStore(accountId, createHostRuntimeSessionStore({ hostRuntime, accountId }));
  await hydrateZalouserSessions(accountId);

  const probe = await probeZalouser(profile, 15_000);
  if (!probe.ok) {
    installZalouserSessionStore(accountId, undefined);
    throw new Error(
      `zalouser account "${accountId}" is not linked (profile "${profile}"): ${probe.error ?? "no saved Zalo session"}. Run the QR login (channel setup) to link it.`,
    );
  }
  const ownUserId = await resolveZaloOwnUserId(profile).catch(() => "");
  const displayName = probe.user?.displayName;
  const inbound = registerAccountInbound(accountId, ownUserId || undefined, hostRuntime);
  const admission = createZalouserAdmission({
    accountId,
    ...(ownUserId === "" ? {} : { ownUserId }),
    ...(log === undefined ? {} : { logger: log }),
    handleInbound: (event) => inbound.handleInbound(event),
  });

  log?.info?.(
    `[${accountId}] starting provider${displayName ? ` (${displayName})` : ""} mode=listener`,
  );
  ctx.setStatus({
    state: "connected",
    accountId,
    mode: "listener",
    ...(probe.user ? { user: probe.user } : {}),
  });
  try {
    await startZalouserListenerSession({
      accountId,
      profile,
      admission,
      abortSignal,
      ...(log === undefined ? {} : { logger: log }),
      setStatus: (patch) => ctx.setStatus({ accountId, ...patch }),
    });
  } finally {
    unregisterAccountInbound(accountId, hostRuntime);
    installZalouserSessionStore(accountId, undefined);
    ctx.setStatus({ state: "stopped", accountId });
  }
}
