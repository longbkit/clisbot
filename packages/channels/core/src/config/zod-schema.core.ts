// Fusion-owned partial port of `src/config/zod-schema.core.ts` (D-CORE-337).
//
// Upstream's module is the whole OpenClaw config zod surface (~1000 lines over
// agents, sessions, gateway, TTS, streaming and every channel knob). Fusion's
// Hub compiles channel config from its own revision store, so only the policy
// enums the ported channel config schemas reference are carried, with
// upstream's definitions.
import { z } from "zod";

export const ReplyToModeSchema = z.union([
  z.literal("off"),
  z.literal("first"),
  z.literal("all"),
  z.literal("batched"),
]);

export const GroupPolicySchema = z.enum(["open", "disabled", "allowlist"]);

export const DmPolicySchema = z.enum(["pairing", "allowlist", "open", "disabled"]);
export const ContextVisibilityModeSchema = z.enum(["all", "allowlist", "allowlist_quote"]);
