// upstream: extensions/telegram/src/accounts.ts@5d8067a4483
// D-TG-010: account resolution is a Fusion boundary. The upstream module reads
// the OpenClaw config graph, the secret-ref/tokenFile resolvers and the
// account-selection warnings; Fusion's Hub owns channel configuration and
// credentials. `./fusion/account-config.ts` keeps every upstream signature and
// the `ResolvedTelegramAccount` shape. Ported files keep importing `./accounts.js`.
export {
  createTelegramActionGate,
  listEnabledTelegramAccounts,
  listTelegramAccountIds,
  mergeTelegramAccountConfig,
  resolveDefaultTelegramAccountId,
  resolveTelegramAccount,
  resolveTelegramAccountConfig,
  resolveTelegramMediaRuntimeOptions,
  resolveTelegramPollActionGateState,
  type ResolvedTelegramAccount,
  type TelegramMediaRuntimeOptions,
  type TelegramPollActionGateState,
} from "./fusion/account-config.js";
