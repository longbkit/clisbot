// Fusion-owned boundary for `src/plugin-sdk/host-runtime.ts` (D-CORE-246).
//
// Upstream also re-exports `normalizeScpRemoteHost` from `src/infra/scp-host.ts`,
// an SSH host parser no ported channel file reads.
export { normalizeHostname } from "../infra/net/hostname.js";
