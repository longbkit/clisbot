// Effective capability resolution per provider-by-backend combination, plus
// the markdown rendering used for the committed capability-matrix doc.
//
// Effective capabilities = the backend's declared matrix narrowed by the
// provider's expectations (e.g. ACP resume requires the agent to support
// session/load). Runtime behavior still re-checks live agent capabilities at
// initialize; this table is the declared truth for docs and operators.

import {
  ACP_RUNNER_CAPABILITIES,
  TMUX_RUNNER_CAPABILITIES,
  type RunnerBackendId,
  type RunnerCapabilities,
} from "../contract/capabilities.ts";
import { CLI_PROVIDERS } from "./index.ts";
import type { AgentCliToolId, CliProviderDefinition } from "./provider.ts";

export type ProviderBackendSupport = {
  supported: boolean;
  capabilities?: RunnerCapabilities;
  maturity?: string;
  costNote?: string;
};

export function describeProviderBackendSupport(
  provider: CliProviderDefinition,
  backend: RunnerBackendId,
): ProviderBackendSupport {
  if (backend === "tmux") {
    return {
      supported: true,
      capabilities: TMUX_RUNNER_CAPABILITIES,
      maturity: "validated",
    };
  }
  if (backend === "acp") {
    if (!provider.acp) {
      return { supported: false };
    }
    return {
      supported: true,
      capabilities: {
        ...ACP_RUNNER_CAPABILITIES,
        resume: provider.acp.expectations.loadSession,
      },
      maturity: provider.acp.maturity,
      costNote: provider.acp.costNote,
    };
  }
  return { supported: false };
}

const CAPABILITY_LABELS: Array<{ key: keyof RunnerCapabilities; label: string }> = [
  { key: "steer", label: "steer (mid-turn inject)" },
  { key: "interrupt", label: "interrupt (/stop)" },
  { key: "resume", label: "resume stored session" },
  { key: "attachView", label: "attach live view" },
  { key: "permissionRequests", label: "permission requests" },
  { key: "structuredEvents", label: "structured events" },
  { key: "nativeSlashCommands", label: "native slash commands" },
  { key: "shellCommands", label: "shell commands (!cmd)" },
  { key: "nudge", label: "nudge (/nudge)" },
];

function renderFlag(value: boolean | undefined) {
  return value === undefined ? "—" : value ? "✅" : "❌";
}

export function renderCapabilityMatrixMarkdown() {
  const providerIds = Object.keys(CLI_PROVIDERS) as AgentCliToolId[];
  const lines: string[] = [
    "# Runner Capability Matrix",
    "",
    "Generated from `src/runners/catalog/` by `scripts/generate-capability-matrix.ts`.",
    "Do not edit by hand: run `bun run docs:capability-matrix` after catalog changes.",
    "",
    "Steer on non-steer backends degrades to interrupt-and-redirect (`/steer`)",
    "or queue admission (implicit follow-ups); shell and nudge decline with",
    "truthful guidance.",
    "",
    "## Backend Capabilities By Provider",
    "",
  ];

  const header = ["Capability", ...providerIds.flatMap((id) => [`${id} · tmux`, `${id} · acp`])];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const { key, label } of CAPABILITY_LABELS) {
    const cells = providerIds.flatMap((id) => {
      const provider = CLI_PROVIDERS[id];
      const tmux = describeProviderBackendSupport(provider, "tmux");
      const acp = describeProviderBackendSupport(provider, "acp");
      return [
        renderFlag(tmux.capabilities?.[key]),
        acp.supported ? renderFlag(acp.capabilities?.[key]) : "—",
      ];
    });
    lines.push(`| ${[label, ...cells].join(" | ")} |`);
  }

  lines.push("", "## Provider Notes", "");
  for (const id of providerIds) {
    const provider = CLI_PROVIDERS[id];
    lines.push(`### ${provider.label} (\`${id}\`)`, "");
    lines.push(`- new-session command: \`${provider.newSessionCommand}\``);
    if (provider.acp) {
      lines.push(`- ACP adapter: \`${provider.acp.adapterPin}\` (maturity: ${provider.acp.maturity})`);
      lines.push(
        `- ACP auth methods: ${provider.acp.authMethods
          .map((method) => `\`${method.id}\` (${method.kind})`)
          .join(", ")}`,
      );
      if (provider.acp.costNote) {
        lines.push(`- cost: ${provider.acp.costNote}`);
      }
    } else {
      lines.push("- ACP: not available; tmux only");
    }
    for (const note of provider.notes ?? []) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
