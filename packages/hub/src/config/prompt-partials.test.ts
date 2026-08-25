import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  MAX_PROMPT_PARTIAL_CONTENT_BYTES,
  hashPromptPartialContent,
  resolvePromptPartials,
  resolvePromptPartialsFromBundle,
  PromptPartialBundleError,
  validatePromptPartialPath,
} from "./prompt-partials.js";

describe("prompt partial resolution", () => {
  it("resolves a relative path once and treats nested include-looking text as content", async () => {
    const content = "Do this literally: { include: nested.md }";
    const resolved = await resolvePromptPartials({
      configuration: {
        triggers: [{ steps: [{ prompt: [{ include: "partials/docs/safety.md" }] }] }],
      },
      read: async (path) => {
        assert.equal(path, ".paseo/workflows/partials/docs/safety.md");
        return { kind: "file", content };
      },
    });

    assert.deepEqual(
      [...resolved.values()],
      [
        {
          path: ".paseo/workflows/partials/docs/safety.md",
          content,
          contentHash: hashPromptPartialContent(content),
        },
      ],
    );
  });

  it.each([
    "../secret.md",
    "nested/../../secret.md",
    "%2e%2e/secret.md",
    "%252e%252e/secret.md",
    "/etc/passwd",
    "\\\\server\\share\\secret.md",
    "C:\\secret.md",
    "docs/./safety.md",
  ])("rejects unsafe partial path %s", (path) => {
    assert.throws(() => validatePromptPartialPath(path), /invalid prompt partial/iu);
  });

  it.each([
    { kind: "directory" as const },
    { kind: "symlink" as const },
    { kind: "submodule" as const },
  ])("rejects a GitHub object that is not a regular file (%s)", async (object) => {
    await assert.rejects(
      resolvePromptPartials({
        configuration: { triggers: [{ steps: [{ prompt: [{ include: "partials/safety.md" }] }] }] },
        read: async () => object,
      }),
      /not a regular file/iu,
    );
  });

  it("rejects a missing partial", async () => {
    await assert.rejects(
      resolvePromptPartials({
        configuration: {
          triggers: [{ steps: [{ prompt: [{ include: "partials/missing.md" }] }] }],
        },
        read: async () => undefined,
      }),
      /does not exist at exact commit/iu,
    );
  });

  it("resolves an API bundle using only normalized submitted files", async () => {
    const content = "Use the submitted instructions.";
    const resolved = await resolvePromptPartialsFromBundle({
      configuration: {
        triggers: [{ steps: [{ prompt: [{ include: "partials/docs/safety.md" }] }] }],
      },
      files: [{ path: "partials\\docs\\safety.md", content }],
    });

    assert.deepEqual(
      [...resolved.values()],
      [
        {
          path: ".paseo/workflows/partials/docs/safety.md",
          content,
          contentHash: hashPromptPartialContent(content),
        },
      ],
    );
  });

  it.each([
    {
      name: "missing",
      configuration: { triggers: [{ steps: [{ prompt: [{ include: "partials/missing.md" }] }] }] },
      files: [],
      path: ["partials", ".paseo/workflows/partials/missing.md"],
    },
    {
      name: "unsafe",
      configuration: { triggers: [] },
      files: [{ path: "../secret.md", content: "secret" }],
      path: ["partials", 0, "path"],
    },
    {
      name: "duplicate",
      configuration: { triggers: [] },
      files: [
        { path: "partials/safety.md", content: "one" },
        { path: "partials/safety%2emd", content: "two" },
      ],
      path: ["partials", 1, "path"],
    },
    {
      name: "unexpected",
      configuration: { triggers: [] },
      files: [{ path: "partials/unused.md", content: "unused" }],
      path: ["partials", 0, "path"],
    },
  ])("rejects $name API bundle files", async ({ configuration, files, path }) => {
    await assert.rejects(
      resolvePromptPartialsFromBundle({ configuration, files }),
      (error: unknown) => {
        assert.ok(error instanceof PromptPartialBundleError);
        assert.deepEqual(error.issues[0]?.path, path);
        return true;
      },
    );
  });

  it("rejects an oversized API partial", async () => {
    await assert.rejects(
      resolvePromptPartialsFromBundle({
        configuration: { triggers: [] },
        files: [{ path: "large.md", content: "x".repeat(MAX_PROMPT_PARTIAL_CONTENT_BYTES + 1) }],
      }),
      (error: unknown) => {
        assert.ok(error instanceof PromptPartialBundleError);
        assert.deepEqual(error.issues[0]?.path, ["partials", 0, "content"]);
        return true;
      },
    );
  });
});
