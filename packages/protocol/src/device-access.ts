import { z } from "zod";

export const DeviceProofSchema = z.object({
  backendId: z.string().min(1).max(128),
  credentialId: z.string().min(1).max(128),
  timestamp: z.number().int(),
  nonce: z.string().min(22).max(128),
  signature: z.string().max(128),
});

export const DeviceCredentialSchema = z.object({
  backendId: z.string().min(1).max(128),
  credentialId: z.string().min(1).max(128),
});

export const DevicePairingGrantSchema = z.object({
  backendId: z.string().min(1).max(128),
  token: z.string().length(43),
  expiresAt: z.number().int(),
});
