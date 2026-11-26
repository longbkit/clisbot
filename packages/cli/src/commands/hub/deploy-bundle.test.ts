import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverHubBundle } from "./deploy-bundle.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("Hub deployment bundle discovery", () => {
  it("discovers the canonical bundle in deterministic path order", async () => {
    const cwd = await canonicalProject();
    await writeFile(
      path.join(cwd, ".clisbot", "workflows", "z-last.yml"),
      workflow("z-last", "codex-safe"),
    );

    await expect(discoverHubBundle({ cwd, project: "studio-api" })).resolves.toEqual({
      projectSlug: "studio-api",
      workflowCount: 2,
      files: [
        { path: ".clisbot/hub.yml", content: hubResource },
        {
          path: ".clisbot/workflows/answer.yml",
          content: workflow("answer", "${{ clisbot.inputs.agent }}", true),
        },
        {
          path: ".clisbot/workflows/partials/safety.md",
          content: "Keep the request in clisbot.prompt and evidence in clisbot.context.\n",
        },
        { path: ".clisbot/workflows/z-last.yml", content: workflow("z-last", "codex-safe") },
      ],
    });
  });

  it.each([
    {
      name: "missing hub.yml",
      arrange: async (cwd: string) => {
        await mkdir(path.join(cwd, ".clisbot", "workflows"), { recursive: true });
      },
      code: "HUB_RESOURCE_MISSING",
      message: ".clisbot/hub.yml does not exist",
    },
    {
      name: "missing workflow directory",
      arrange: async (cwd: string) => {
        await mkdir(path.join(cwd, ".clisbot"), { recursive: true });
        await writeFile(path.join(cwd, ".clisbot", "hub.yml"), hubResource);
      },
      code: "HUB_WORKFLOW_DIRECTORY_MISSING",
      message: ".clisbot/workflows does not exist",
    },
    {
      name: "empty workflow directory",
      arrange: async (cwd: string) => {
        await mkdir(path.join(cwd, ".clisbot", "workflows"), { recursive: true });
        await writeFile(path.join(cwd, ".clisbot", "hub.yml"), hubResource);
      },
      code: "HUB_WORKFLOW_MISSING",
      message: ".clisbot/workflows must contain at least one direct-child .yml workflow",
    },
    {
      name: "unsupported workflow extension",
      arrange: async (cwd: string) => {
        await mkdir(path.join(cwd, ".clisbot", "workflows"), { recursive: true });
        await writeFile(path.join(cwd, ".clisbot", "hub.yml"), hubResource);
        await writeFile(path.join(cwd, ".clisbot", "workflows", "answer.yaml"), "name: answer\n");
      },
      code: "HUB_WORKFLOW_EXTENSION_UNSUPPORTED",
      message: ".clisbot/workflows/answer.yaml must use the .yml extension",
    },
  ])("rejects $name before contacting Hub", async ({ arrange, code, message }) => {
    const cwd = await temporaryDirectory();
    await arrange(cwd);

    await expect(discoverHubBundle({ cwd, project: "studio-api" })).rejects.toMatchObject({
      code,
      message: expect.stringContaining(message),
    });
  });

  it("rejects prompt partial traversal with a path-specific diagnostic", async () => {
    const cwd = await canonicalProject();
    await writeFile(
      path.join(cwd, ".clisbot", "workflows", "answer.yml"),
      workflow("answer", "codex-safe").replace(
        "      - text: ${{ clisbot.prompt }}",
        "      - include: ../secret.md",
      ),
    );

    await expect(discoverHubBundle({ cwd, project: "studio-api" })).rejects.toMatchObject({
      code: "HUB_PARTIAL_PATH_INVALID",
      message: expect.stringContaining(".clisbot/workflows/answer.yml"),
    });
  });

  it("reports a referenced partial that is missing from the bundle", async () => {
    const cwd = await canonicalProject();
    await writeFile(
      path.join(cwd, ".clisbot", "workflows", "answer.yml"),
      workflow("answer", "codex-safe").replace(
        "      - text: ${{ clisbot.prompt }}",
        "      - include: partials/missing.md",
      ),
    );

    await expect(discoverHubBundle({ cwd, project: "studio-api" })).rejects.toMatchObject({
      code: "HUB_BUNDLE_FILE_MISSING",
      message: expect.stringContaining(".clisbot/workflows/partials/missing.md"),
    });
  });

  it("rejects nested workflow files instead of discovering a second layout", async () => {
    const cwd = await canonicalProject();
    await mkdir(path.join(cwd, ".clisbot", "workflows", "nested"));
    await writeFile(
      path.join(cwd, ".clisbot", "workflows", "nested", "other.yml"),
      workflow("other", "codex-safe"),
    );

    await expect(discoverHubBundle({ cwd, project: "studio-api" })).rejects.toMatchObject({
      code: "HUB_WORKFLOW_PATH_UNSUPPORTED",
      message: expect.stringContaining(".clisbot/workflows/nested"),
    });
  });

  it("rejects symlinked workflow and partial paths without reading their targets", async () => {
    const cwd = await canonicalProject();
    const outside = path.join(cwd, "outside.yml");
    await writeFile(outside, workflow("linked", "codex-safe"));
    await symlink(outside, path.join(cwd, ".clisbot", "workflows", "linked.yml"));

    await expect(discoverHubBundle({ cwd, project: "studio-api" })).rejects.toMatchObject({
      code: "HUB_BUNDLE_UNSAFE_PATH",
      message: expect.stringContaining(".clisbot/workflows/linked.yml"),
    });
  });

  it("requires an explicit valid project slug outside the authored bundle", async () => {
    const cwd = await canonicalProject();

    await expect(discoverHubBundle({ cwd })).rejects.toMatchObject({
      code: "HUB_PROJECT_REQUIRED",
    });
    await expect(discoverHubBundle({ cwd, project: "Studio API" })).rejects.toMatchObject({
      code: "HUB_INVALID_PROJECT",
    });
  });
});

const hubResource = [
  "environments:",
  "  studio:",
  "    kind: daemon",
  "    daemon: local",
  "    cwd: /workspace/studio",
  "agents:",
  "  codex-safe:",
  "    provider: codex",
  "    model: gpt-5.5",
  "    thinkingOptionId: xhigh",
  "    options:",
  "      sandbox_workspace_write:",
  "        writable_roots: [/var/cache/npm]",
  "        network_access: false",
  "  claude:",
  "    provider: claude",
  "    mode: bypassPermissions",
  "",
].join("\n");

function workflow(name: string, agent: string, include = false): string {
  return [
    `name: ${name}`,
    "on: manual.run",
    "max_runtime: 1h",
    ...(agent.includes("clisbot.inputs")
      ? ["inputs:", "  agent:", "    type: string", "    choices: [codex-safe, claude]"]
      : []),
    "steps:",
    "  - id: work",
    "    environment: studio",
    "    max_runtime: 30m",
    "    idle_timeout: 5m",
    `    agent: ${agent}`,
    "    prompt:",
    ...(include ? ["      - include: partials/safety.md"] : []),
    "      - text: ${{ clisbot.prompt }}",
    "",
  ].join("\n");
}

async function canonicalProject(): Promise<string> {
  const cwd = await temporaryDirectory();
  const workflows = path.join(cwd, ".clisbot", "workflows");
  await mkdir(path.join(workflows, "partials"), { recursive: true });
  await writeFile(path.join(cwd, ".clisbot", "hub.yml"), hubResource);
  await writeFile(
    path.join(workflows, "answer.yml"),
    workflow("answer", "${{ clisbot.inputs.agent }}", true),
  );
  await writeFile(
    path.join(workflows, "partials", "safety.md"),
    "Keep the request in clisbot.prompt and evidence in clisbot.context.\n",
  );
  return cwd;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "clisbot-hub-bundle-"));
  temporaryDirectories.push(directory);
  return directory;
}
