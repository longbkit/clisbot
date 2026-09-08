import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { applyManifest, deriveSpecifierMap } from "./channel-upstream-sync-apply.mjs";
import {
  buildReport,
  checkManifest,
  compareVerbatim,
  mergeSyncMd,
  renderSyncSection,
} from "./channel-upstream-sync.mjs";

const VERBATIM_SOURCE =
  `import { helper } from "openclaw/plugin-sdk/runtime";\n` +
  `import { expectDefined } from "@openclaw/normalization-core/expect";\n\n` +
  `export function greet(name) {\n  return expectDefined(helper(\`hi \${name}\`));\n}\n`;

/** The same file as ported: both specifiers rewritten, one onto a vendored file. */
const LOCAL_A =
  `import { helper } from "@getpaseo/channels-shared";\n` +
  `import { expectDefined } from "./vendor/expect.js";\n\n\n` +
  `export function greet(name) {\n  return expectDefined(helper(\`hi \${name}\`));   \n}\n`;

function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function write(root, relative, content) {
  const full = path.join(root, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function commit(repo, message) {
  git(repo, "add", "-A");
  git(repo, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-m", message);
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}

/** Temp upstream repo (two commits) + a temp local package with a manifest. */
function withFixture(
  run,
  { manifestOverrides = {}, localOverrides = {}, removeUpstreamAtHead = [], extraFiles = [] } = {},
) {
  const root = mkdtempSync(path.join(tmpdir(), "channel-upstream-sync-"));
  const upstream = path.join(root, "upstream");
  const pkg = path.join(root, "pkg");
  try {
    mkdirSync(upstream, { recursive: true });
    git(upstream, "init", "-q", "-b", "main");
    write(upstream, "extensions/demo/src/a.ts", VERBATIM_SOURCE);
    write(upstream, "extensions/demo/src/b.ts", "export const b = 1;\n");
    write(upstream, "extensions/demo/src/c.ts", "export const c = 1;\n");
    write(upstream, "extensions/demo/src/e.ts", "export const e = 1;\n");
    write(upstream, "extensions/demo/src/sub/f.ts", "export const f = 1;\n");
    write(
      upstream,
      "extensions/demo/package.json",
      JSON.stringify({ dependencies: { grammy: "1.44.0" } }),
    );
    const baselineCommit = commit(upstream, "baseline");
    write(
      upstream,
      "extensions/demo/src/a.ts",
      `${VERBATIM_SOURCE}import { c } from "./c.js";\nimport { d } from "./d.js";\n` +
        "export const extra = 1;\n",
    );
    write(upstream, "extensions/demo/src/d.ts", "export const d = 1;\n");
    write(
      upstream,
      "extensions/demo/src/sub/f.ts",
      'import { helper } from "openclaw/plugin-sdk/runtime";\n' +
        'import { expectDefined } from "@openclaw/normalization-core/expect";\n\n' +
        "export const f = expectDefined(helper(1));\n",
    );
    write(
      upstream,
      "extensions/demo/package.json",
      JSON.stringify({ dependencies: { grammy: "1.45.0" } }),
    );
    for (const relative of removeUpstreamAtHead) rmSync(path.join(upstream, relative));
    const headCommit = commit(upstream, "upstream moves");

    write(pkg, "package.json", JSON.stringify({ dependencies: { grammy: "1.44.0" } }));
    write(pkg, "src/a.ts", `// upstream: extensions/demo/src/a.ts@${baselineCommit}\n${LOCAL_A}`);
    write(pkg, "src/vendor/expect.ts", "export const expectDefined = (value) => value;\n");
    write(pkg, "src/b.ts", "export const b = 2;\n");
    write(
      pkg,
      "src/nested/c.ts",
      `// upstream: extensions/demo/src/c.ts@${baselineCommit}\nexport const c = 1;\n`,
    );
    write(
      pkg,
      "src/sub/f.ts",
      `// upstream: extensions/demo/src/sub/f.ts@${baselineCommit}\nexport const f = 1;\n`,
    );
    write(pkg, "src/local.ts", "export const local = 1;\n");
    write(pkg, "src/b.test.ts", "export const spec = 1;\n");
    for (const [relative, content] of Object.entries(localOverrides))
      write(pkg, relative, content.replaceAll("BASELINE", baselineCommit));
    const manifest = {
      upstreamRepo: "demo",
      baselineCommit,
      roots: [{ upstream: "extensions/demo/src", local: "src" }],
      files: [
        { local: "src/a.ts", upstream: "extensions/demo/src/a.ts", status: "verbatim" },
        {
          local: "src/b.ts",
          upstream: "extensions/demo/src/b.ts",
          status: "adapted",
          deviation: "D-001",
        },
        { local: "src/sub/f.ts", upstream: "extensions/demo/src/sub/f.ts", status: "verbatim" },
        { local: "src/local.ts", status: "fusion-owned" },
        { local: "src/vendor/expect.ts", status: "fusion-owned" },
        { local: "src/nested/c.ts", upstream: "extensions/demo/src/c.ts", status: "verbatim" },
        ...extraFiles,
      ],
      omitted: [{ upstream: "extensions/demo/src/e.ts", reason: "not needed" }],
      deviations: [
        { id: "D-001", file: "src/b.ts", reason: "different constant", tests: ["src/b.test.ts"] },
      ],
      ...manifestOverrides,
    };
    write(pkg, "upstream-sync.json", JSON.stringify(manifest, null, 2));
    run({
      upstream,
      pkg,
      manifestPath: path.join(pkg, "upstream-sync.json"),
      baselineCommit,
      headCommit,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function check(fixture, options = {}) {
  return checkManifest(fixture.manifestPath, { upstreamDir: fixture.upstream, ...options });
}

test("a truthful manifest passes and reports test files separately", () => {
  withFixture((fixture) => {
    const result = check(fixture);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.tests, ["src/b.test.ts"]);
    assert.equal(result.counts.verbatim, 3);
    assert.equal(result.counts["fusion-owned"], 2);
  });
});

test("verbatim tolerates the upstream header, import rewrites and whitespace", () => {
  assert.equal(
    compareVerbatim(
      `// upstream: x@1\nimport a from "./local.js";\n`,
      `import a from "openclaw/a";\n`,
    ).equal,
    true,
  );
  assert.equal(compareVerbatim("const a = 1;\n", "const a = 2;\n").equal, false);
});

test("a verbatim entry that really differs fails", () => {
  withFixture(
    (fixture) => {
      const result = check(fixture);
      assert.equal(result.failures.length, 1);
      assert.match(result.failures[0], /marked verbatim but differs/);
    },
    { localOverrides: { "src/a.ts": `${VERBATIM_SOURCE}export const drifted = 1;\n` } },
  );
});

test("an unmapped local production file fails, and a missing local file fails", () => {
  withFixture(
    (fixture) => {
      const failures = check(fixture).failures.join("\n");
      assert.match(failures, /src\/orphan\.ts has no manifest entry/);
    },
    { localOverrides: { "src/orphan.ts": "export const orphan = 1;\n" } },
  );
  withFixture(
    (fixture) => {
      assert.match(check(fixture).failures.join("\n"), /src\/gone\.ts: local file missing/);
    },
    {
      manifestOverrides: {
        files: [
          {
            local: "src/gone.ts",
            upstream: "extensions/demo/src/b.ts",
            status: "adapted",
            deviation: "D-001",
          },
        ],
      },
    },
  );
});

test("an upstream path absent at the baseline fails", () => {
  withFixture(
    (fixture) => {
      assert.match(
        check(fixture).failures.join("\n"),
        /extensions\/demo\/src\/nope\.ts missing at/,
      );
    },
    {
      manifestOverrides: {
        files: [
          {
            local: "src/b.ts",
            upstream: "extensions/demo/src/nope.ts",
            status: "adapted",
            deviation: "D-001",
          },
        ],
      },
    },
  );
});

test("deviation bookkeeping is enforced", () => {
  withFixture(
    (fixture) => {
      const failures = check(fixture).failures.join("\n");
      assert.match(failures, /needs a deviation id/);
      assert.match(failures, /not referenced by any file entry/);
    },
    {
      manifestOverrides: {
        files: [
          { local: "src/b.ts", upstream: "extensions/demo/src/b.ts", status: "reimplemented" },
        ],
      },
    },
  );
  withFixture(
    (fixture) => {
      const failures = check(fixture).failures.join("\n");
      assert.match(failures, /duplicate id/);
      assert.match(failures, /test src\/missing\.test\.ts does not exist/);
    },
    {
      manifestOverrides: {
        deviations: [
          { id: "D-001", file: "src/b.ts", reason: "one" },
          { id: "D-001", file: "src/b.ts", reason: "two", tests: ["src/missing.test.ts"] },
        ],
      },
    },
  );
});

test("unmapped upstream files warn by default and fail with --strict", () => {
  withFixture(
    (fixture) => {
      assert.match(check(fixture).warnings.join("\n"), /1 unmapped upstream file/);
      assert.match(
        check(fixture, { strict: true }).failures.join("\n"),
        /1 unmapped upstream file/,
      );
    },
    { manifestOverrides: { omitted: [] } },
  );
});

test("report shows changed files, new upstream files and dependency deltas", () => {
  withFixture((fixture) => {
    const report = buildReport(fixture.manifestPath, {
      upstreamDir: fixture.upstream,
      to: fixture.headCommit,
    });
    const changed = report.files.filter((row) => row.delta).map((row) => row.upstream);
    assert.deepEqual(changed, ["extensions/demo/src/a.ts", "extensions/demo/src/sub/f.ts"]);
    assert.deepEqual(report.newUpstreamFiles, ["extensions/demo/src/d.ts"]);
    assert.deepEqual(report.deps, [
      { name: "grammy", local: "1.44.0", baseline: "1.44.0", to: "1.45.0" },
    ]);
  });
});

test("sync-md keeps the preamble, drops legacy tables and is stable on regeneration", () => {
  withFixture((fixture) => {
    const manifest = check(fixture).manifest;
    const legacy =
      "# demo SYNC\n\nKeep me.\n\n## Module → OpenClaw source manifest\n\n| a | b |\n\n## OUT OF SCOPE (group E)\n\ngone\n";
    const first = mergeSyncMd(legacy, renderSyncSection(manifest));
    assert.match(first, /Keep me\./);
    assert.doesNotMatch(first, /OUT OF SCOPE/);
    assert.match(
      first,
      /\| `src\/a\.ts` +\| `extensions\/demo\/src\/a\.ts` +\| verbatim +\| — +\|/,
    );
    assert.equal(mergeSyncMd(first, renderSyncSection(manifest)), first);
  });
});

// ------------------------------------------------------------------- apply

function apply(fixture, options = {}) {
  return applyManifest(fixture.manifestPath, {
    upstreamDir: fixture.upstream,
    from: fixture.baselineCommit,
    to: fixture.headCommit,
    ...options,
  });
}

function rowFor(result, local) {
  return result.rows.find((entry) => entry.local === local);
}

test("apply lands a clean delta, keeping the header and the import rewrite", () => {
  withFixture((fixture) => {
    const result = apply(fixture);
    assert.equal(rowFor(result, "src/a.ts").result, "clean");
    const applied = readFileSync(path.join(fixture.pkg, "src/a.ts"), "utf8");
    assert.equal(
      applied.split("\n")[0],
      `// upstream: extensions/demo/src/a.ts@${fixture.headCommit}`,
    );
    assert.match(applied, /from "@getpaseo\/channels-shared"/);
    assert.match(applied, /export const extra = 1;/);
    assert.doesNotMatch(applied, /<<<<<<</);
    assert.deepEqual(result.newUpstreamFiles, ["extensions/demo/src/d.ts"]);
    assert.deepEqual(result.deletedUpstreamFiles, []);
    // The merge cannot port the file the new import points at; it says so.
    // `./c.js` is ported under a different local path; `./d.js` is not ported.
    assert.deepEqual(rowFor(result, "src/a.ts").notes, [
      "rewrote new import ./c.js → ./nested/c.js",
      "unported import extensions/demo/src/d.ts",
    ]);
    assert.match(
      readFileSync(path.join(fixture.pkg, "src/a.ts"), "utf8"),
      /from ".\/nested\/c.js"/,
    );
  });
});

test("apply rewrites an import the delta introduces from the package's own evidence", () => {
  withFixture((fixture) => {
    const result = apply(fixture);
    assert.equal(rowFor(result, "src/sub/f.ts").result, "clean");
    // `src/a.ts` is the only evidence for either rewrite, and it is enough. The
    // vendored one is re-derived for `src/sub/`, not copied from `src/`.
    const applied = readFileSync(path.join(fixture.pkg, "src/sub/f.ts"), "utf8");
    assert.match(applied, /from "@getpaseo\/channels-shared"/);
    assert.match(applied, /from "\.\.\/vendor\/expect\.js"/);
    assert.deepEqual(rowFor(result, "src/sub/f.ts").notes, [
      'rewrote new import "openclaw/plugin-sdk/runtime" → "@getpaseo/channels-shared"',
      'rewrote new import "@openclaw/normalization-core/expect" → "../vendor/expect.js"',
    ]);
  });
});

test("apply refuses to pick when two local files claim the same upstream file", () => {
  withFixture(
    (fixture) => {
      const notes = rowFor(apply(fixture, { dryRun: true }), "src/a.ts").notes.join("\n");
      assert.match(
        notes,
        /ambiguous port target for \.\/c\.js: src\/nested\/c\.ts, src\/legacy-c\.ts/,
      );
      assert.doesNotMatch(notes, /rewrote new import \.\/c\.js/);
    },
    {
      extraFiles: [
        {
          local: "src/legacy-c.ts",
          upstream: "extensions/demo/src/c.ts",
          status: "reimplemented",
          deviation: "D-001",
        },
      ],
      localOverrides: { "src/legacy-c.ts": "export const legacyC = 1;\n" },
    },
  );
});

test("apply skips adapted files unless asked, and only then bumps the baseline", () => {
  withFixture((fixture) => {
    const skipped = apply(fixture, { dryRun: true });
    assert.match(rowFor(skipped, "src/b.ts").reason, /--include-adapted/);
    assert.equal(skipped.baselineBumped, false);
    assert.equal(readFileSync(path.join(fixture.pkg, "src/a.ts"), "utf8").includes("extra"), false);

    const result = apply(fixture, { includeAdapted: true });
    assert.equal(rowFor(result, "src/b.ts").result, "unchanged");
    assert.equal(result.fullyClean, true);
    assert.equal(result.baselineBumped, true);
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
    assert.equal(manifest.baselineCommit, fixture.headCommit);
    assert.deepEqual(check(fixture).failures, []);
  });
});

test("apply writes conflict markers where the port really drifted", () => {
  withFixture(
    (fixture) => {
      const result = apply(fixture);
      assert.equal(rowFor(result, "src/a.ts").result, "conflict");
      assert.equal(result.fullyClean, false);
      const applied = readFileSync(path.join(fixture.pkg, "src/a.ts"), "utf8");
      assert.match(applied, /^<<<<<<< local$/m);
      assert.match(
        applied,
        new RegExp(`^\\|\\|\\|\\|\\|\\|\\| upstream@${fixture.baselineCommit}$`, "m"),
      );
      assert.match(applied, /export const localTail = 1;/);
      assert.match(applied, /export const extra = 1;/);
      assert.equal(
        applied.split("\n")[0],
        `// upstream: extensions/demo/src/a.ts@${fixture.baselineCommit}`,
      );
    },
    {
      localOverrides: {
        "src/a.ts": `// upstream: extensions/demo/src/a.ts@BASELINE\n${VERBATIM_SOURCE}export const localTail = 1;\n`,
      },
    },
  );
});

test("apply reports a deleted upstream file and never invents one", () => {
  withFixture(
    (fixture) => {
      const result = apply(fixture, { dryRun: true });
      assert.equal(rowFor(result, "src/b.ts").result, "skipped");
      assert.deepEqual(
        result.deletedUpstreamFiles.map((entry) => entry.file),
        ["extensions/demo/src/c.ts"],
      );
    },
    { removeUpstreamAtHead: ["extensions/demo/src/c.ts"] },
  );
});

test("a specifier map is derived positionally and refuses to guess", () => {
  const local = 'import { a } from "@local/x";\nimport { b } from "./y.js";\n';
  const upstream = 'import { a } from "openclaw/x";\nimport { b } from "./y.js";\n';
  const derived = deriveSpecifierMap(local, upstream);
  assert.equal(derived.derivable, true);
  assert.deepEqual([...derived.map], [["openclaw/x", "@local/x"]]);
  assert.equal(deriveSpecifierMap('import "a";\n', upstream).derivable, false);
});

test("restoreVerbatimFile rebuilds a reflowed verbatim file with local specifiers", async () => {
  const { restoreVerbatimFile } = await import("./channel-upstream-sync.mjs");
  const upstream = 'import { a, b } from "openclaw/x";\nexport const v = a + b;\n';
  const local =
    '// upstream: src/f.ts@abc\nimport {\n  a,\n  b,\n} from "@getpaseo/channels-core/x";\nexport const v = a + b;\n';
  const result = restoreVerbatimFile(local, upstream, "// upstream: src/f.ts@abc");
  assert.equal(result.ok, true);
  assert.equal(
    result.text,
    '// upstream: src/f.ts@abc\nimport { a, b } from "@getpaseo/channels-core/x";\nexport const v = a + b;\n',
  );
});
