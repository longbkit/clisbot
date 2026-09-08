// upstream: extensions/zalouser/src/probe.ts@5d8067a4483
// Zalouser plugin module implements probe behavior.
import type { BaseProbeResult } from "@getpaseo/channels-core/plugin-sdk/channel-contract";
import { formatErrorMessage } from "@getpaseo/channels-core/plugin-sdk/error-runtime";
import { resolveTimerTimeoutMs } from "@getpaseo/channels-core/plugin-sdk/number-runtime";
import { runChannelProbe } from "@getpaseo/channels-core/plugin-sdk/text-utility-runtime";
import type { ZcaUserInfo } from "./types.js";
import { getZaloUserInfo } from "./zalo-js.js";

export type ZalouserProbeResult = BaseProbeResult<string> & {
  user?: ZcaUserInfo;
  elapsedMs?: number;
};

export async function probeZalouser(
  profile: string,
  timeoutMs?: number,
): Promise<ZalouserProbeResult> {
  return await runChannelProbe(
    timeoutMs ? resolveTimerTimeoutMs(timeoutMs, 1000, 1000) : undefined,
    async () => {
      const user = await getZaloUserInfo(profile);
      return user ? { ok: true, user } : { ok: false, error: "Not authenticated" };
    },
    (error) => ({ ok: false, error: formatErrorMessage(error) }),
  );
}
