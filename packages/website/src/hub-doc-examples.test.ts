import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { getDoc, getDocs, getLegacyDocsRedirect, parseHeadings } from "./docs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const hubDocs = path.join(repositoryRoot, "public-docs", "hub");

/**
 * The bundled Clisbot Hub is the contract these guides describe: every complete example must be
 * accepted by the same parsers Hub runs when an Automation is saved or a bundle is activated.
 * Hub source targets Node and newer library types than the website, so it is loaded at test time
 * rather than pulled into the website's type program.
 */
interface HubParsers {
  compileAutomationDocument(yaml: string): { format: "single_run" | "workflow" };
  compileHubBundle(
    files: readonly { path: string; content: string }[],
    options?: { requireWorkflow?: boolean },
  ): { configuration: { triggers: readonly unknown[] } };
}

async function hubParsers(): Promise<HubParsers> {
  const hubSource = path.join(repositoryRoot, "packages", "hub", "src");
  const modules = [
    path.join(hubSource, "triggers", "configuration", "workflow-document.ts"),
    path.join(hubSource, "config", "bundle.ts"),
  ];
  const [workflowDocument, bundle] = await Promise.all(modules.map((module) => import(module)));
  return {
    compileAutomationDocument: workflowDocument.compileAutomationDocument,
    compileHubBundle: bundle.compileHubBundle,
  };
}

/**
 * Resources the legacy bundle guides tell the reader to define in `.clisbot/hub.yml` before adding
 * a workflow ("defines the `dev` environment and `codex` agent"). Documented `hub.yml` examples are
 * merged on top, so a workflow example may also use the resources another example declares.
 */
const ASSUMED_BUNDLE_RESOURCES = {
  environments: {
    dev: { kind: "daemon", daemon: "devbox", cwd: "/workspace/project" },
    triage: { kind: "daemon", daemon: "devbox", cwd: "/workspace/project" },
  },
  agents: {
    codex: { provider: "codex" },
    classifier: { provider: "claude" },
  },
};

/** Fields and events of getpaseo/hub that the bundled Clisbot Hub rejects or never dispatches. */
const UPSTREAM_ONLY_FIELDS = ["continuation", "tools", "background", "recurrence"];
const UPSTREAM_ONLY_EVENTS = ["schedule.tick", "webhook.received"];

type ExampleKind = "trigger" | "workflow" | "bundle-workflow" | "bundle-resources" | "fragment";

interface Example {
  label: string;
  kind: ExampleKind;
  source: string;
  value: unknown;
}

describe("Hub public documentation examples", () => {
  it("accepts every complete Hub YAML example with the bundled Hub parser", async () => {
    const { compileAutomationDocument, compileHubBundle } = await hubParsers();
    const examples = await hubExamples();
    const byKind = countBy(examples.map((example) => example.kind));
    // Keep each supported authoring form covered, including the legacy stepped workflows.
    expect(byKind.get("trigger") ?? 0).toBeGreaterThanOrEqual(10);
    expect(byKind.get("workflow") ?? 0).toBeGreaterThanOrEqual(1);
    expect(byKind.get("bundle-workflow") ?? 0).toBeGreaterThanOrEqual(6);
    expect(byKind.get("bundle-resources") ?? 0).toBeGreaterThanOrEqual(1);

    const resources = bundleResources(examples);
    const rejected: string[] = [];
    for (const example of examples) {
      try {
        if (example.kind === "trigger") {
          expect(compileAutomationDocument(example.source).format, example.label).toBe(
            "single_run",
          );
        } else if (example.kind === "workflow") {
          expect(compileAutomationDocument(example.source).format, example.label).toBe("workflow");
        } else if (example.kind === "bundle-workflow") {
          const bundle = compileHubBundle([
            { path: ".clisbot/hub.yml", content: YAML.stringify(resources) },
            { path: ".clisbot/workflows/example.yml", content: example.source },
          ]);
          expect(bundle.configuration.triggers.length, example.label).toBe(1);
        } else if (example.kind === "bundle-resources") {
          // An `agents`-only excerpt still needs the environments a real hub.yml always has.
          const content =
            isRecord(example.value) && !Object.hasOwn(example.value, "environments")
              ? YAML.stringify({
                  environments: ASSUMED_BUNDLE_RESOURCES.environments,
                  ...example.value,
                })
              : example.source;
          compileHubBundle([{ path: ".clisbot/hub.yml", content }], { requireWorkflow: false });
        }
      } catch (error) {
        rejected.push(`${example.label}: ${error instanceof Error ? error.message : error}`);
      }
    }
    expect(rejected).toEqual([]);
  });

  it("keeps Hub YAML examples canonical and free of upstream-only fields", async () => {
    const examples = await hubExamples();
    expect(examples.length).toBeGreaterThan(20);
    for (const { label, value } of examples) {
      if (!isRecord(value)) continue;
      expect(value, `${label} must not teach monolithic triggers`).not.toHaveProperty("triggers");
      if (Object.hasOwn(value, "agents")) {
        expect(isRecord(value["agents"]), `${label} agents`).toBe(true);
      }
      const keys = [...yamlKeys(value)];
      for (const field of UPSTREAM_ONLY_FIELDS) {
        expect(keys, `${label} must not teach getpaseo/hub-only ${field}`).not.toContain(field);
      }
      for (const event of UPSTREAM_ONLY_EVENTS) {
        expect(keys, `${label} must not teach getpaseo/hub-only ${event}`).not.toContain(event);
      }
    }
  });

  it("does not teach removed Hub authoring paths", async () => {
    const markdown = (
      await Promise.all((await markdownFiles(hubDocs)).map((file) => readFile(file, "utf8")))
    ).join("\n");

    // Prompt partials live under .clisbot/workflows/partials/; there is no composition syntax.
    expect(markdown).not.toContain(".clisbot/partials/");
    expect(markdown).not.toMatch(/^triggers:/mu);
    expect(markdown).not.toMatch(/^\s+uses:/mu);
    expect(markdown).not.toContain("clisbot hub deploy [file]");
    // Upstream pages for getpaseo/hub-only features are archived, not published.
    expect(markdown).not.toMatch(
      /\/webhooks\/wh_|whsec_|POST \/api\/v1\/triggers\/webhook-secret/u,
    );
  });

  it.each(["en", "zh-CN"] as const)(
    "resolves every internal /docs/hub link and heading anchor in %s",
    (locale) => {
      const docs = getDocs(locale);
      const headingsByHref = new Map(docs.map((doc) => [doc.href, headingIds(doc.content)]));
      const hubPages = docs.filter(
        (doc) => doc.href === "/docs/hub" || doc.href.startsWith("/docs/hub/"),
      );
      expect(hubPages.length).toBeGreaterThanOrEqual(25);

      const broken: string[] = [];
      for (const doc of hubPages) {
        for (const match of doc.content.matchAll(/\]\((\/docs\/[^)\s]*)\)/gu)) {
          const target = match[1] ?? "";
          const [rawPath, hash] = target.split("#");
          const cleanPath = (rawPath ?? "").replace(/\/$/u, "");
          const headings = headingsByHref.get(cleanPath);
          if (!headings) {
            broken.push(`${doc.sourcePath} -> missing page ${target}`);
          } else if (hash && !headings.has(hash)) {
            broken.push(`${doc.sourcePath} -> missing anchor ${target}`);
          }
        }
        for (const match of doc.content.matchAll(/\]\((#[^)\s]+)\)/gu)) {
          const hash = (match[1] ?? "").slice(1);
          if (!headingIds(doc.content).has(hash)) {
            broken.push(`${doc.sourcePath} -> missing anchor #${hash}`);
          }
        }
      }
      expect(broken).toEqual([]);
    },
  );

  it("does not publish pages for getpaseo/hub features the bundled Hub lacks", () => {
    for (const locale of ["en", "zh-CN"] as const) {
      for (const slug of ["hub/tools", "hub/triggers/webhooks", "hub/triggers/schedules"]) {
        expect(getDoc(slug, locale), `${locale} ${slug}`).toBeUndefined();
      }
    }
    const triggers = getDoc("hub/triggers", "en");
    expect(headingIds(triggers?.content ?? "")).toContain("not-available-in-clisbot-hub");
  });

  it("redirects removed Hub guide paths to current pages", () => {
    const redirects = [
      ["/docs/hub/workflows", "/docs/hub/configuration/reference"],
      ["/docs/hub/configuration/hub-yml", "/docs/hub/configuration/reference"],
      ["/docs/hub/tools", "/docs/hub/triggers"],
      ["/docs/hub/triggers/webhooks", "/docs/hub/triggers"],
      ["/docs/hub/triggers/schedules", "/docs/hub/triggers"],
    ] as const;

    for (const [legacyPath, targetPath] of redirects) {
      expect(getDoc(targetPath.slice("/docs/".length), "en")).toBeDefined();
      expect(getDoc(targetPath.slice("/docs/".length), "zh-CN")).toBeDefined();
      for (const extension of ["", ".md"]) {
        expect(getLegacyDocsRedirect(`${legacyPath}${extension}`)).toBe(
          `${targetPath}${extension}`,
        );
        expect(getLegacyDocsRedirect(`${legacyPath}${extension}/`)).toBe(
          `${targetPath}${extension}`,
        );
        expect(getLegacyDocsRedirect(`${targetPath}${extension}`)).toBeUndefined();
      }
    }
  });
});

async function hubExamples(): Promise<Example[]> {
  const files = [
    ...(await markdownFiles(hubDocs)),
    path.join(repositoryRoot, "public-docs", "cli.md"),
  ];
  const examples: Example[] = [];
  for (const file of files) {
    const markdown = await readFile(file, "utf8");
    for (const [index, source] of yamlFences(markdown).entries()) {
      const label = `${path.relative(repositoryRoot, file)} YAML example ${index + 1}`;
      const value: unknown = YAML.parse(source);
      expect(value, label).not.toBeUndefined();
      examples.push({ label, kind: exampleKind(value), source, value });
    }
  }
  return examples;
}

/** A complete document names itself and its events; anything else is an illustrative fragment. */
function exampleKind(value: unknown): ExampleKind {
  if (!isRecord(value)) return "fragment";
  const named = typeof value["name"] === "string" && value["on"] !== undefined;
  if (named && Object.hasOwn(value, "run")) return "trigger";
  if (named && Object.hasOwn(value, "steps")) {
    return isRecord(value["on"]) ? "workflow" : "bundle-workflow";
  }
  if (
    !Object.hasOwn(value, "on") &&
    (isRecord(value["environments"]) || isRecord(value["agents"]))
  ) {
    return "bundle-resources";
  }
  return "fragment";
}

function bundleResources(examples: readonly Example[]) {
  const environments: Record<string, unknown> = { ...ASSUMED_BUNDLE_RESOURCES.environments };
  const agents: Record<string, unknown> = { ...ASSUMED_BUNDLE_RESOURCES.agents };
  for (const { kind, value } of examples) {
    if (kind !== "bundle-resources" || !isRecord(value)) continue;
    if (isRecord(value["environments"])) Object.assign(environments, value["environments"]);
    if (isRecord(value["agents"])) Object.assign(agents, value["agents"]);
  }
  return { environments, agents };
}

function* yamlKeys(value: unknown): Generator<string> {
  if (Array.isArray(value)) {
    for (const item of value) yield* yamlKeys(item);
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      yield key;
      yield* yamlKeys(child);
    }
  }
}

function countBy<T>(values: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function headingIds(content: string): Set<string> {
  return new Set(parseHeadings(content).map((heading) => heading.id));
}

function yamlFences(markdown: string): readonly string[] {
  return [...markdown.matchAll(/```yaml\s*\n([\s\S]*?)```/gu)].map((match) => match[1] ?? "");
}

async function markdownFiles(directory: string): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(target)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
  }
  return files.sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
