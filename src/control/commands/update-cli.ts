import { renderCliCommand } from "./cli-name.ts";

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/longbkit/clisbot/main";

export function renderUpdateHelp() {
  return [
    `${renderCliCommand("update")} / ${renderCliCommand("update --help")}`,
    "Start here for any clisbot install or update request.",
    "Prints this guide only. Direct update is not supported yet.",
    "A bot can use this guide to update itself.",
    "",
    "Targets:",
    "  stable/latest/default -> clisbot@latest",
    "  beta                  -> clisbot@beta",
    "  exact version         -> clisbot@<version>",
    "",
    "Flow:",
    `  1. ${renderCliCommand("status")}`,
    "  2. Read docs in priority order and follow them before installing.",
    "  3. npm install -g clisbot@<target> && clisbot restart",
    `  4. ${renderCliCommand("status")}`,
    "  5. Report version, health, manual action, and useful release highlights.",
    "",
    "Docs, read in order:",
    `  1. Migration index: ${GITHUB_RAW_BASE}/docs/migrations/index.md`,
    "     If Manual action: required, follow its runbook. If none, continue.",
    `  2. Update guide: ${GITHUB_RAW_BASE}/docs/updates/update-guide.md`,
    "     Use for target choice, install flow, and verification.",
    `  3. Release notes: ${GITHUB_RAW_BASE}/docs/releases/README.md`,
    "     Use for the canonical version map and full version notes.",
    `  4. Release guides: ${GITHUB_RAW_BASE}/docs/updates/README.md`,
    "     Use for shorter catch-up notes: what changed, what to try, and what to watch.",
    "  5. Full docs: https://github.com/longbkit/clisbot/tree/main/docs",
    "     Use for deep questions. If needed, fetch or clone docs and inspect relevant files.",
    "",
    "Rules:",
    "  - Use npm dist-tags, not highest semver.",
    "  - Stable/latest is default; beta only when the user asks.",
    "  - If install mode is not normal global npm, stop and ask.",
  ].join("\n");
}

export async function runUpdateCli(args: string[]) {
  const action = args[0];
  if (
    !action ||
    action === "--help" ||
    action === "-h" ||
    action === "help"
  ) {
    console.log(renderUpdateHelp());
    return;
  }

  throw new Error(renderUpdateHelp());
}
