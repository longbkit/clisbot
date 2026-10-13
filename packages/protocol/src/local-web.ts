import { z } from "zod";
// COMPAT(localWeb): optional capability; older Hosts require CLI setup.
export const LocalWebRequestSchema = z.object({
  type: z.literal("daemon.web.request"),
  requestId: z.string().min(1),
  action: z.enum(["start", "status", "stop"]),
});
export const LocalWebResponseSchema = z.object({
  type: z.literal("daemon.web.response"),
  payload: z.object({
    requestId: z.string(),
    enabled: z.boolean(),
    running: z.boolean(),
    origin: z.string().nullable(),
    tailscaleUrl: z.string().nullable(),
  }),
});
export type LocalWebStatus = Omit<z.infer<typeof LocalWebResponseSchema>["payload"], "requestId">;
