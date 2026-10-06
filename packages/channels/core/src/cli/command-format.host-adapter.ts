// Fusion-owned boundary for `src/cli/command-format.ts` and `src/version.ts`
// (D-CORE-702).
//
// Upstream formats OpenClaw CLI command examples (with container/profile hints)
// for messages such as "run `openclaw channels login` to relink". In Clisbot an
// operator links and unlinks a QR channel from its Connection in the app, not
// from a CLI, so the login/logout hints become that instruction and any other
// `openclaw` command is shown under the Clisbot CLI name.
import { createRequire } from "node:module";

const CLI_PREFIX_RE = /^(?:pnpm|npm|bunx|npx)\s+openclaw\b|^openclaw\b/;
const LOGIN_RE = /^openclaw\s+channels\s+login\b/;
const LOGOUT_RE = /^openclaw\s+channels\s+logout\b/;

const ACCOUNT_RE = /--account\s+(\S+)/;

function accountSuffix(command: string): string {
  const account = ACCOUNT_RE.exec(command)?.[1];
  return account ? ` for account ${account}` : "";
}

/** Upstream `formatCliCommand`, re-pointed at where Clisbot does the same thing. */
export function formatCliCommand(command: string): string {
  const trimmed = command.trim();
  if (LOGIN_RE.test(trimmed)) {
    return `Link on the channel's Connection in Clisbot (Settings → Channels) and scan the QR code${accountSuffix(trimmed)}`;
  }
  if (LOGOUT_RE.test(trimmed)) {
    return `Unlink on the channel's Connection in Clisbot (Settings → Channels)${accountSuffix(trimmed)}`;
  }
  return trimmed.replace(CLI_PREFIX_RE, "clisbot");
}

/** The running channel package's version (upstream: the OpenClaw build version). */
export const VERSION: string = (
  createRequire(import.meta.url)("../../package.json") as { version: string }
).version;
