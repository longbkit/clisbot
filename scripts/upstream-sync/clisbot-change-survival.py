#!/usr/bin/env python3
"""Check that every Clisbot commit's changes survived an upstream merge.

For each non-merge Clisbot commit in a range, take the lines it added that are
still present just before the merge (`--pre`), and report the ones missing
after it (`--post`). A missing line is either a deliberate adaptation to a
changed upstream API or a loss; review each one. Also reports Clisbot files
that disappeared.

The normalized-base comparison in the sync playbook cannot see a line where
Clisbot deliberately kept upstream's raw text (a temporary `paseo` endpoint):
Git treats that side as unchanged and takes the renamed upstream line. This
check does.

Usage:
  python3 scripts/upstream-sync/clisbot-change-survival.py \\
    --since <previous upstream merge> --pre <main before merge> --post <merged> \\
    [--exclude <ref of retired history>] [--json out.json]
"""

import argparse
import json
import subprocess
import sys


def git(repo, *args):
    return subprocess.run(
        ["git", "-C", repo, *args], capture_output=True, text=True, errors="replace"
    ).stdout


def normalize(line):
    return " ".join(line.split())


class Files:
    def __init__(self, repo):
        self.repo = repo
        self.cache = {}

    def lines(self, rev, path):
        key = (rev, path)
        if key not in self.cache:
            result = subprocess.run(
                ["git", "-C", self.repo, "show", f"{rev}:{path}"], capture_output=True
            )
            if result.returncode:
                self.cache[key] = None
            else:
                try:
                    text = result.stdout.decode("utf8")
                    self.cache[key] = {normalize(line) for line in text.splitlines()}
                except UnicodeDecodeError:
                    self.cache[key] = "binary"
        return self.cache[key]


def added_lines(repo, commit):
    diff = git(repo, "show", "--format=", "--unified=0", "--no-renames", commit)
    added, path = {}, None
    for line in diff.splitlines():
        if line.startswith("diff --git"):
            path = None
        elif line.startswith("+++ "):
            path = None if line[4:] == "/dev/null" else line[6:]
        elif path and line.startswith("+"):
            text = normalize(line[1:])
            if len(text) > 3:
                added.setdefault(path, []).append(text)
    return added


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=".")
    parser.add_argument("--since", required=True)
    parser.add_argument("--pre", required=True)
    parser.add_argument("--post", required=True)
    parser.add_argument("--exclude", action="append", default=[])
    parser.add_argument("--json")
    args = parser.parse_args()

    revs = [f"{args.since}..{args.pre}", *[f"^{ref}" for ref in args.exclude]]
    commits = git(args.repo, "rev-list", "--no-merges", "--reverse", *revs).split()
    files = Files(args.repo)
    report = []
    for commit in commits:
        missing, lost_files = {}, []
        for path, lines in added_lines(args.repo, commit).items():
            pre = files.lines(args.pre, path)
            if pre in (None, "binary"):
                continue
            post = files.lines(args.post, path)
            if post is None:
                lost_files.append(path)
                continue
            if post == "binary":
                continue
            gone = [line for line in lines if line in pre and line not in post]
            if gone:
                missing[path] = gone
        subject = git(args.repo, "log", "-1", "--format=%s", commit).strip()
        report.append(
            {"commit": commit[:9], "subject": subject, "missing": missing, "lostFiles": lost_files}
        )
        count = sum(len(lines) for lines in missing.values())
        print(f"{commit[:9]} missing={count:4} lostFiles={len(lost_files)}  {subject[:80]}")
    if args.json:
        with open(args.json, "w") as handle:
            json.dump(report, handle, indent=1, ensure_ascii=False)
    intact = sum(1 for entry in report if not entry["missing"] and not entry["lostFiles"])
    print(f"\n{intact}/{len(report)} commits intact", file=sys.stderr)


if __name__ == "__main__":
    main()
