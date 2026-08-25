import { dump, load } from "js-yaml";
import type { HubBundleFile } from "../config/bundle.js";

/** Builds canonical authored files for runtime-focused tests from their in-memory graph fixture. */
export function configurationBundleFixture(yaml: string): HubBundleFile[] {
  const raw = load(yaml);
  if (!isRecord(raw) || !Array.isArray(raw["environments"]) || !Array.isArray(raw["triggers"])) {
    throw new Error("runtime configuration fixture must contain environments and triggers");
  }
  const environments = Object.fromEntries(
    raw["environments"].map((environment) => {
      if (!isRecord(environment) || typeof environment["name"] !== "string") {
        throw new Error("runtime configuration fixture environment requires a name");
      }
      const { name, ...configuration } = environment;
      return [name, configuration];
    }),
  );
  const files: HubBundleFile[] = [
    {
      path: ".paseo/hub.yml",
      content: dump({ environments, agents: {} }, { noRefs: true, lineWidth: -1 }),
    },
  ];
  for (const trigger of raw["triggers"]) {
    if (!isRecord(trigger) || typeof trigger["name"] !== "string") {
      throw new Error("runtime configuration fixture trigger requires a name");
    }
    rewriteFixtureIncludes(trigger);
    files.push({
      path: `.paseo/workflows/${trigger["name"]}.yml`,
      content: dump(trigger, { noRefs: true, lineWidth: -1 }),
    });
  }
  return files;
}

function rewriteFixtureIncludes(trigger: Record<string, unknown>): void {
  if (!Array.isArray(trigger["steps"])) return;
  for (const step of trigger["steps"]) {
    if (!isRecord(step) || !Array.isArray(step["prompt"])) continue;
    for (const block of step["prompt"]) {
      if (
        isRecord(block) &&
        typeof block["include"] === "string" &&
        !block["include"].startsWith("partials/")
      ) {
        block["include"] = `partials/${block["include"]}`;
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
