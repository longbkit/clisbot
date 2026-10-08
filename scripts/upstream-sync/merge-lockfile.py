#!/usr/bin/env python3
"""Three-way merge package-lock.json during an upstream sync.

Takes the lock from the merge base (normalized), Clisbot (stage 2) and upstream
(stage 3) and merges it key by key: a value only one side changed wins, and a
value both sides changed takes upstream's (in practice these are version bumps;
every one is printed for review). The root `workspaces` list comes from the
resolved root package.json. Run `npm install --package-lock-only --ignore-scripts`
afterwards so npm reconciles the result, then `npm ci`.

Usage: python3 scripts/upstream-sync/merge-lockfile.py --nbase <dir>
"""

import argparse
import json
import subprocess

MISSING = object()


def stage(number):
    result = subprocess.run(
        ["git", "show", f":{number}:package-lock.json"], capture_output=True, check=True
    )
    return json.loads(result.stdout)


def merge(base, ours, theirs, path, conflicts, workspaces):
    if ours == theirs or theirs == base:
        return ours
    if ours == base:
        return theirs
    if isinstance(ours, dict) and isinstance(theirs, dict):
        base = base if isinstance(base, dict) else {}
        merged = {}
        for key in dict.fromkeys([*ours, *theirs]):
            value = merge(
                base.get(key, MISSING),
                ours.get(key, MISSING),
                theirs.get(key, MISSING),
                [*path, key],
                conflicts,
                workspaces,
            )
            if value is not MISSING:
                merged[key] = value
        return merged
    if path and path[-1] == "workspaces":
        return workspaces
    conflicts.append((path, ours, theirs))
    return theirs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--nbase", required=True)
    args = parser.parse_args()
    with open(f"{args.nbase}/package-lock.json") as handle:
        base = json.load(handle)
    try:
        with open("package.json") as handle:
            workspaces = json.load(handle)["workspaces"]
    except json.JSONDecodeError:
        raise SystemExit("Resolve the root package.json first; it still has conflict markers.")
    conflicts = []
    merged = merge(base, stage(2), stage(3), [], conflicts, workspaces)
    with open("package-lock.json", "w") as handle:
        handle.write(json.dumps(merged, indent=2) + "\n")
    for path, ours, theirs in conflicts:
        print(f"both changed, took upstream: {'/'.join(path)}: {ours!r} -> {theirs!r}")
    print(f"{len(conflicts)} values both sides changed")


if __name__ == "__main__":
    main()
