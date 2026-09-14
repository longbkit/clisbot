import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function command(program: string, args: string[]): string | null {
  try {
    return execFileSync(program, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim();
  } catch {
    return null;
  }
}
export function sourceState() {
  const diff = command("git", ["diff", "--binary", "HEAD"]);
  const untracked = (command("git", ["ls-files", "--others", "--exclude-standard", "-z"]) ?? "")
    .split("\0")
    .filter(Boolean);
  const untrackedContent = createHash("sha256");
  for (const file of untracked.sort()) {
    untrackedContent.update(file).update("\0").update(readFileSync(file));
  }
  return {
    head: command("git", ["rev-parse", "HEAD"]),
    upstream: command("git", ["rev-parse", "upstream/main"]),
    status: command("git", ["status", "--porcelain=v1"]),
    trackedDiffSha256: createHash("sha256")
      .update(diff ?? "")
      .digest("hex"),
    untrackedContentSha256: untrackedContent.digest("hex"),
  };
}
