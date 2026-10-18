import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { connectDaemonClient } from "./daemon-client-loader";
import { test as base, expect } from "../fixtures";

export { expect };
export const disabledQueueProviders = Object.fromEntries(
  ["claude", "codex", "copilot", "opencode", "pi", "omp"].map((id) => [id, { enabled: false }]),
);
/** Child-only empty homes, never metadata/provider forks from a real account. */
export const test = base.extend<{ queueProviderProof: void }>({
  queueProviderProof: [
    async ({ e2eWorker }, provide, info) => {
      void e2eWorker;
      const client = await connectDaemonClient<DaemonClient>({
        clientIdPrefix: "queue-isolation-proof",
      });
      try {
        const snapshot = await client.getProvidersSnapshot();
        const disabled = snapshot.entries
          ?.filter((entry) => Object.hasOwn(disabledQueueProviders, entry.provider))
          .map(({ provider, enabled, status }) => ({ provider, enabled, status }));
        expect(disabled).toHaveLength(6);
        for (const entry of disabled ?? [])
          expect(entry).toMatchObject({ enabled: false, status: "unavailable" });
        const proof = {
          disabled,
          home: "fresh child-only temporary home; real provider homes empty and isolated",
        };
        const proofPath = info.outputPath("effective-provider-isolation.json");
        await writeFile(proofPath, JSON.stringify(proof, null, 2));
        await info.attach("effective-provider-isolation", {
          path: proofPath,
          contentType: "application/json",
        });
        await provide();
      } finally {
        await client.close();
      }
    },
    { auto: true },
  ],
  e2eDaemonEnvironment: [
    async ({ e2eForkProviders }, provide) => {
      void e2eForkProviders;
      if (process.env.E2E_FORK_CLISBOT_HOME_FROM || process.env.E2E_CLISBOT_HOME)
        throw new Error(
          "Queue fixtures require fresh isolated homes; remove inherited E2E home/fork overrides",
        );
      const home = await mkdtemp(path.join(tmpdir(), "clisbot-queue-provider-home-"));
      const environment = {
        HOME: home,
        USERPROFILE: home,
        CODEX_HOME: path.join(home, ".codex"),
        CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
        PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"),
        PI_CODING_AGENT_SESSION_DIR: path.join(home, ".pi", "agent", "sessions"),
        XDG_CONFIG_HOME: path.join(home, ".config"),
        XDG_DATA_HOME: path.join(home, ".local", "share"),
        CLISBOT_TAILSCALE_BIN: process.execPath,
      };
      await Promise.all(
        Object.values(environment)
          .filter((value) => value !== process.execPath)
          .map((directory) => mkdir(directory, { recursive: true })),
      );
      try {
        await provide(environment);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],
});
