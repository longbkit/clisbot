import { existsSync } from "node:fs";
import { connectToDaemon } from "../../utils/client.js";
import { readUpgradeReport, saveUpgradeReport } from "./prepare-upgrade.js";

/** Register existing directories through the daemon; never rewrite their contents. */
export async function registerLegacyWorkspaces(home: string): Promise<void> {
  if (process.env.CLISBOT_V1_MIGRATION_ENABLED === "0") return;
  const report = readUpgradeReport(home);
  if (!report || report.phase !== "prepared") return;
  const missing = [...new Set(report.agents.map((agent) => agent.workspace))].filter(
    (directory) => !report.registeredWorkspaces.includes(directory),
  );
  if (missing.length === 0) return;
  const client = await connectToDaemon({ target: { kind: "instance", home } });
  try {
    const existing = await client.listProjects();
    for (const directory of missing) {
      if (!existsSync(directory)) continue;
      const known = existing.projects.some((project) => project.projectRootPath === directory);
      if (!known) {
        const result = await client.addProject(directory);
        if (!result.project) throw new Error(result.error ?? "Unable to register legacy workspace");
      }
      report.registeredWorkspaces.push(directory);
      saveUpgradeReport(home, report);
    }
  } finally {
    await client.close();
  }
}
