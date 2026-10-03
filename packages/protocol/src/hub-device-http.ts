import { z } from "zod";

export const HubDeviceRequestSchema = z
  .object({
    type: z.literal("hub.http.request"),
    id: z.string().min(1).max(80),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string().min(1).max(4096),
    headers: z.record(z.string(), z.string().max(2048)),
    body: z
      .string()
      .max(1024 * 1024)
      .optional(),
  })
  .strict();
export const HubDeviceResponseSchema = z
  .object({
    type: z.literal("hub.http.response"),
    id: z.string().max(80),
    status: z.number().int().min(100).max(599),
    headers: z.record(z.string(), z.string()),
    cookies: z.array(z.string()).max(16),
    body: z.string().max(6 * 1024 * 1024),
  })
  .strict();
export type HubDeviceRequest = z.infer<typeof HubDeviceRequestSchema>;
export type HubDeviceResponse = z.infer<typeof HubDeviceResponseSchema>;

export function isDeviceHubPath(path: string): boolean {
  // No generic URL, traversal, redirect destination or backend socket access.
  if (!/^\/api\/(auth|management)(?:\/|\?|$)/.test(path) || /[\\#]/.test(path)) return false;
  const url = new URL(path, "https://hub.invalid");
  return url.origin === "https://hub.invalid" && `${url.pathname}${url.search}` === path;
}
