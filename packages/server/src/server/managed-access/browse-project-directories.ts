import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

/** Shallow Host browsing for Add Project, under the same folder policy as creation. */
export async function browseProjectDirectories(input: {
  browsePath: string;
  home: string;
  query: string;
  limit?: number;
  filter: (entries: { path: string }[]) => Promise<{ path: string }[]>;
  canSelect: (target: string) => Promise<boolean>;
}) {
  const requested = input.browsePath.trim();
  let expanded = requested;
  if (requested === "~") expanded = input.home;
  else if (requested.startsWith("~/")) expanded = path.join(input.home, requested.slice(2));
  if (!path.isAbsolute(expanded)) throw new Error("Enter an absolute Host path or ~");
  const current = await realpath(expanded);
  if (!(await input.filter([{ path: current }])).length) {
    throw new Error("You do not have access to browse this folder");
  }
  const names = await readdir(current, { withFileTypes: true });
  const query = input.query.trim().toLowerCase();
  const candidates = await Promise.all(
    names
      .filter((entry) => !entry.name.startsWith(".") && entry.name.toLowerCase().includes(query))
      .map(async (entry) => {
        const target = path.join(current, entry.name);
        const directory =
          entry.isDirectory() ||
          (entry.isSymbolicLink() &&
            (await stat(target).then(
              (value) => value.isDirectory(),
              () => false,
            )));
        return directory ? { path: target } : null;
      }),
  );
  const visible = await input.filter(candidates.filter((entry) => entry !== null));
  visible.sort((a, b) => a.path.localeCompare(b.path));
  const limit = input.limit ?? 100;
  const parent = path.dirname(current);
  const parentAllowed = parent !== current && (await input.filter([{ path: parent }])).length > 0;
  return {
    entries: visible
      .slice(0, limit)
      .map((entry) => ({ path: entry.path, kind: "directory" as const })),
    directory: {
      path: current,
      parentPath: parentAllowed ? parent : null,
      truncated: visible.length > limit,
      canSelect: await input.canSelect(current),
    },
  };
}
