import { z } from "zod";
export const DaemonDevicesRequestSchema = z.object({
  type: z.literal("daemon.devices.request"),
  requestId: z.string(),
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("list") }),
    z.object({
      kind: z.literal("rename"),
      deviceId: z.string().max(128),
      label: z.string().min(1).max(80),
    }),
    z.object({ kind: z.literal("revoke"), deviceId: z.string().max(128) }),
  ]),
});
export const DaemonDevicesResponseSchema = z.object({
  type: z.literal("daemon.devices.response"),
  payload: z.object({
    requestId: z.string(),
    devices: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        createdAt: z.number(),
        lastSeenAt: z.number().nullable(),
        revokedAt: z.number().nullable(),
        sessions: z.array(z.object({ clientId: z.string(), connected: z.boolean() })),
      }),
    ),
  }),
});
export type DaemonDevicesAction = z.infer<typeof DaemonDevicesRequestSchema>["action"];
