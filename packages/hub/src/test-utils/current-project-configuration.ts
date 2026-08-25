import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { HubBundleFile } from "../config/bundle.js";

const fixtureRoot = join(process.cwd(), "src/config/fixtures/current-project");

export async function currentProjectConfigurationFiles(): Promise<HubBundleFile[]> {
  const paseo = join(fixtureRoot, ".paseo");
  const workflow = join(paseo, "workflows");
  const partials = join(workflow, "partials");
  const workflowNames = (await readdir(workflow)).filter((name) => name.endsWith(".yml"));
  const partialNames = await readdir(partials);
  const paths = [
    join(paseo, "hub.yml"),
    ...workflowNames.map((name) => join(workflow, name)),
    ...partialNames.map((name) => join(partials, name)),
  ];
  return Promise.all(
    paths.map(async (path) => ({
      path: relative(fixtureRoot, path),
      content: await readFile(path, "utf8"),
    })),
  );
}
