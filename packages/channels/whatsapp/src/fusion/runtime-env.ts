// Fusion-owned boundary for the theme half of `plugin-sdk/runtime-env`
// (D-WA-012), the same shape as the Slack vertical's `fusion/runtime-env.ts`.
//
// Upstream's barrel exports `info` / `success` / `danger` / `warn` as theme
// formatters (`(text) => string`) and a `RuntimeEnv` whose `log` is always
// present; ported WhatsApp files write `runtime.log(info("…"))`. Core's carried
// `globals.ts` exports them as logger calls and makes `log` optional
// (D-CORE-232, D-CORE-233). This module keeps the barrel's shape: everything
// comes from core, the formatters are the identity (the Hub logger owns
// presentation), and `defaultRuntime` / `RuntimeEnv` carry a `log`.
import {
  defaultRuntime as coreDefaultRuntime,
  type RuntimeEnv as CoreRuntimeEnv,
} from "@clisbot/channels-core/plugin-sdk/runtime-env";

export * from "@clisbot/channels-core/plugin-sdk/runtime-env";

export type RuntimeEnv = CoreRuntimeEnv & { log: (message: string) => void };

export const defaultRuntime: RuntimeEnv = {
  ...coreDefaultRuntime,
  log: (message: string) => (coreDefaultRuntime.log ?? coreDefaultRuntime.error)(message),
};

/** Theme formatter. The Hub's logger owns presentation, so the text passes through. */
export function info(text: string): string {
  return text;
}

/** Theme formatter. See `info`. */
export function success(text: string): string {
  return text;
}

/** Theme formatter. See `info`. */
export function danger(text: string): string {
  return text;
}

/** Theme formatter. See `info`. */
export function warn(text: string): string {
  return text;
}
