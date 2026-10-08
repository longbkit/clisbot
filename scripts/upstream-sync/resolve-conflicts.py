#!/usr/bin/env python3
"""Classify an in-progress upstream merge against the normalized merge base.

Run inside the merge worktree after `git merge --no-commit` stops. For each
conflicted file, compare Clisbot (stage 2) and upstream (stage 3) with the same
path in the normalized base (`normalized-base.sh`):

  keep-clisbot   upstream equals the normalized base
  take-upstream  Clisbot equals the normalized base
  clean-merge    a three-way merge against the normalized base has no conflict
  conflict       real overlap; the file is rewritten with zdiff3 markers whose
                 base arm is the normalized base, so only functional edits show
  one-sided      a stage is missing (modify/delete, add/add); left for review

Without --apply it only reports. With --apply it writes and stages the first
three classes and rewrites the conflicts. Package manifests and package-lock.json
are reported as conflicts; resolve manifests by hand and the lock with
merge-lockfile.py.

Usage: python3 scripts/upstream-sync/resolve-conflicts.py --nbase <dir> [--apply] [--json out]
"""

import argparse
import json
import os
import re
import subprocess
import tempfile


def git(*args, data=None):
    return subprocess.run(["git", *args], capture_output=True, input=data)


def stages():
    entries = {}
    for record in git("ls-files", "-u", "-z").stdout.split(b"\0"):
        if not record:
            continue
        meta, path = record.split(b"\t", 1)
        _mode, sha, stage = meta.split()
        entries.setdefault(path.decode(), {})[int(stage)] = sha.decode()
    return entries


def blob(sha):
    return git("cat-file", "blob", sha).stdout


def merge_file(ours, base, theirs, style):
    with tempfile.TemporaryDirectory() as tmp:
        names = []
        for name, data in (("clisbot", ours), ("nbase", base), ("upstream", theirs)):
            path = os.path.join(tmp, name)
            with open(path, "wb") as handle:
                handle.write(data)
            names.append(path)
        result = subprocess.run(
            ["git", "merge-file", "-p", style, "-L", "clisbot", "-L", "nbase", "-L", "upstream", *names],
            capture_output=True,
        )
        return result.returncode == 0, result.stdout


def classify(path, entry, nbase_root):
    if 2 not in entry or 3 not in entry:
        return "one-sided", None
    ours, theirs = blob(entry[2]), blob(entry[3])
    base_path = os.path.join(nbase_root, path)
    base = open(base_path, "rb").read() if os.path.isfile(base_path) else None
    if ours == theirs or (base is not None and theirs == base):
        return "keep-clisbot", ours
    if base is not None and ours == base:
        return "take-upstream", theirs
    if path.endswith("package.json") or path.endswith("package-lock.json"):
        clean, merged = False, None
    else:
        clean, merged = merge_file(ours, base or b"", theirs, "--diff3")
    if clean:
        return "clean-merge", merged
    _clean, marked = merge_file(ours, base or b"", theirs, "--zdiff3")
    return "conflict", marked


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--nbase", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--json")
    args = parser.parse_args()

    report = {}
    hunks = 0
    for path, entry in sorted(stages().items()):
        kind, content = classify(path, entry, args.nbase)
        report.setdefault(kind, []).append(path)
        if kind == "conflict" and content is not None:
            hunks += len(re.findall(rb"^<<<<<<< ", content, re.M))
        if not args.apply or content is None:
            continue
        with open(path, "wb") as handle:
            handle.write(content)
        if kind != "conflict":
            git("add", "--", path)

    for kind in ("keep-clisbot", "take-upstream", "clean-merge", "conflict", "one-sided"):
        print(f"{kind:14} {len(report.get(kind, [])):4}")
    print(f"conflict hunks against the normalized base: {hunks}")
    for path in report.get("one-sided", []):
        print(f"  review: {path}")
    if args.json:
        with open(args.json, "w") as handle:
            json.dump(report, handle, indent=1)


if __name__ == "__main__":
    main()
