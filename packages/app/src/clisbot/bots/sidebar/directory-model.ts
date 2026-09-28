import type { BotsSidebarBot } from "./bots-section";
export type DirectoryOwnership = "all" | "mine" | "shared";
export type DirectorySort = "recent" | "name";
/** Search the loaded metadata catalog, independently of the sidebar's recent slice. */
export function filterDirectoryBots(
  bots: readonly BotsSidebarBot[],
  query: string,
  hostId: string,
  sort: DirectorySort,
  ownership: DirectoryOwnership = "all",
) {
  const term = query.trim().toLocaleLowerCase();
  return bots
    .filter(
      (bot) =>
        (!hostId || bot.serverId === hostId) &&
        (ownership === "all" || bot.isOwner === (ownership === "mine")) &&
        `${bot.name} ${bot.description ?? ""} ${bot.hostName ?? bot.hostLabel ?? ""}`
          .toLocaleLowerCase()
          .includes(term),
    )
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
      return (
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") ||
        a.name.localeCompare(b.name) ||
        a.key.localeCompare(b.key)
      );
    });
}
