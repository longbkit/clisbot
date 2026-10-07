import { z } from "zod";

// COMPAT(hostTailscale): added in v0.10.3, remove after 2027-04-06. Additive Host
// capability; older peers omit it.
// "unavailable" means Tailscale is ready but Serve could not map this Host.
export const TailscaleStateSchema = z.enum([
  "ready",
  "missing",
  "login-required",
  "stopped",
  "unavailable",
]);
export type TailscaleState = z.infer<typeof TailscaleStateSchema>;

export const HostTailscaleSchema = z.object({
  state: TailscaleStateSchema,
  /** This machine's MagicDNS name, when Tailscale runs. */
  dnsName: z.string().max(253).optional(),
  /** The HTTPS origin Serve maps to this Host and the pairing link carries. */
  origin: z.string().max(2048).optional(),
  guidance: z.string().max(4096).optional(),
  /** The tailnet admin page Tailscale asks a person to open before Serve works. */
  actionUrl: z.string().max(2048).optional(),
});
export type HostTailscale = z.infer<typeof HostTailscaleSchema>;

export const DaemonTailscaleStatusRequestSchema = z.object({
  type: z.literal("daemon.tailscale.status.request"),
  requestId: z.string().min(1).max(128),
});
export const DaemonTailscaleStatusResponseSchema = z.object({
  type: z.literal("daemon.tailscale.status.response"),
  payload: z.object({ requestId: z.string(), tailscale: HostTailscaleSchema }),
});

export const DaemonTailscaleSetupRequestSchema = z.object({
  type: z.literal("daemon.tailscale.setup.request"),
  requestId: z.string().min(1).max(128),
  httpsPort: z.number().int().min(1).max(65535).optional(),
});
export const DaemonTailscaleSetupResponseSchema = z.object({
  type: z.literal("daemon.tailscale.setup.response"),
  payload: z.object({ requestId: z.string(), tailscale: HostTailscaleSchema }),
});
