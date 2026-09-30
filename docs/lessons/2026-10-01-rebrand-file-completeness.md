# 2026-10-01 — Rebrand staging can silently omit source files

Read this before transforming an upstream snapshot or promoting the merged
Fusion tree. Evidence: [file completeness audit](../audits/2026-09-30-clisbot-branding/file-completeness.md).

## What happened

| Finding                                                          | Cause                                                                                                                                                 | Fix                                                                                                 |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 15 Hub example/fixture files missing                             | Renaming `.paseo/` to `.clisbot/` put tracked source under a repository ignore rule. Git staged the old paths as deletions and skipped the new paths. | Restore the files and add exceptions for the two exact example/fixture directories.                 |
| One Plugin API integration test missing                          | A machine-wide `plugins/` ignore hid the renamed destination.                                                                                         | Restore the test and exempt the source directory in the repository.                                 |
| 54 session scripts/review outputs plus `cli-client-id` published | Local debugging and runtime artifacts were tracked in the repo root. Rebranding preserved them.                                                       | Archive them locally; remove them from the current tree; document placement and ignore rules.       |
| Seven stale imports in five files, plus a removed helper export  | Referenced modules had moved between folders/packages. Broad typecheck did not cover every test or manual script.                                     | Point imports at current modules/package exports; verify the affected tests and diagnostic bundles. |

Recovery commits: `58914266c` (16 files and the ignore guard), `6188d0d9b`
(stale imports). Cleanup commit: `d514658be`.

## Lessons for the next sync

### 1. A clean checkout and a passing rename check are insufficient

The rename script enumerates `git ls-files`. After an ignored destination is
omitted from staging, `--check` cannot see it; the resulting commit can look
clean and pass the name scan. Compare the expected transformed paths from the
raw snapshot with the staged index **before committing**, then compare the
committed tree again. Every missing path needs an explicit reason.

Apply this to the Fusion baseline as well as the upstream baseline after a
merge. Commit ancestry establishes inclusion in history; conflict resolution
can still omit a file or overwrite its contents. Path presence likewise does
not prove that all behavior survived.

### 2. Inspect repository and machine-wide ignore rules

`--apply` now stops after applying the rename if Git ignores a destination.
The files have already moved at that point: fix the ignore/staging issue,
stage the reviewed paths, then run `--check`. Do not rerun the rename blindly.

```sh
git -C <worktree> check-ignore -v --no-index -- <missing-destination>
git -C <worktree> add -f -- <reviewed-source-file>
git -C <worktree> diff --cached --name-status -M
git -C <worktree> ls-files --error-unmatch -- <expected-destination>
```

Prefer narrow, committed `.gitignore` exceptions for maintained fixtures.
`git -c core.excludesFile=/dev/null ... add -A` avoids machine-wide excludes,
but repository `.gitignore` and `.git/info/exclude` still apply. Never use a
blanket `git add -f .`; credentials and runtime homes must remain excluded.

### 3. Verify consumers as well as filenames

After a folder/package move, check imports, package exports, npm script
arguments, asset manifests and symlinks. Parse actual imports rather than
matching examples inside comments or generated-code strings. Account for
`.js` to TypeScript resolution, test-name filters and build-generated files.

Run the specific affected tests and check diagnostic scripts without opening
live connections. In this audit, 22 unit tests passed and both diagnostics
bundled; this did not establish live-provider or relay success. Build and
exercise the real package when investigating a packaging defect.

### 4. Review publication scope before staging

Use `.debug/scratch/<task>/` for local probes and raw review output. Maintained
tools belong under a named `scripts/` subfolder; durable findings belong in a
topic under `docs/audits/`. Commit portable, sanitized evidence: replace real
people/handles, live channel IDs, personal bot names and private hostnames in
examples. Preserve intentional author attribution and upstream license notices.

Check both secrets and identity data; a secret scanner does not establish that
examples are anonymous. Removing a file from HEAD leaves historical exposure.
Do not rewrite shared history as a routine cleanup step.

## Record before promotion

- Raw upstream SHA, Fusion baseline SHA, transformation revision and final SHA.
- Expected/actual path counts, every intentional deletion, and recovered paths.
- Ignore-rule checks, rename/branding results, and targeted test results.
- Live checks actually performed, unrun checks and accepted follow-ups.

The current audit found no further source omissions after the 16-file recovery;
its counts are a historical baseline, not fixed totals for future releases.
