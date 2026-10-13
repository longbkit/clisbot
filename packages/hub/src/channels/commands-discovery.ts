import { inlineCode } from "./command-reply-format.js";

export interface DiscoveryArguments {
  query: string;
  page: number;
  worktree: boolean;
}
export function discoveryArguments(args: string[]): DiscoveryArguments {
  const tokens = [...args];
  const action = tokens.shift() ?? "list";
  if (action !== "list" && action !== "search")
    throw new Error("Usage: list or search <text> [--page N]");
  let page = 1;
  let worktree = false;
  const words: string[] = [];
  while (tokens.length) {
    const token = tokens.shift()!;
    if (token === "--page") {
      const number = tokens.shift();
      if (!number || !/^[1-9]\d*$/.test(number) || !Number.isSafeInteger(Number(number)))
        throw new Error("--page must be a positive integer.");
      page = Number(number);
    } else if (token === "--worktree") worktree = true;
    else if (token.startsWith("--")) throw new Error(`Unknown option: ${token}`);
    else words.push(token);
  }
  if ((action === "search" && words.length === 0) || (action === "list" && words.length > 0))
    throw new Error("Usage: list [--page N] or search <text> [--page N]");
  return { query: words.join(" "), page, worktree };
}
export function tokenizePlacementArguments(text: string): string[] {
  const result: string[] = [];
  let word = "";
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\\" && i + 1 < text.length && /["'\\]/.test(text[i + 1]!)) word += text[++i];
    else if (quote) {
      if (c === quote) quote = undefined;
      else word += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (/\s/.test(c)) {
      if (word) {
        result.push(word);
        word = "";
      }
    } else word += c;
  }
  if (quote) throw new Error("Close the quoted argument before sending this command.");
  if (word) result.push(word);
  return result;
}
export function search<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) =>
    terms.every((term) => fields(item).some((field) => field.toLocaleLowerCase().includes(term))),
  );
}
export function pageText<T>(
  items: T[],
  args: DiscoveryArguments,
  command: string,
  line: (item: T) => string,
): string {
  const pages = Math.max(1, Math.ceil(items.length / 10));
  if (args.page > pages)
    throw new Error(`Page ${args.page} is unavailable. There are ${pages} page(s).`);
  const start = (args.page - 1) * 10;
  const prefix = `${command} ${args.query ? `search ${JSON.stringify(args.query)}` : "list"}${args.worktree ? " --worktree" : ""}`;
  return [
    `Page ${args.page}/${pages} · ${items.length} results · up to 10 per page`,
    ...(items.length
      ? items.slice(start, start + 10).map((item, i) => `${start + i + 1}. ${line(item)}`)
      : ["No matches."]),
    ...(args.page > 1 ? [`Previous: ${inlineCode(`${prefix} --page ${args.page - 1}`)}`] : []),
    ...(args.page < pages ? [`Next: ${inlineCode(`${prefix} --page ${args.page + 1}`)}`] : []),
  ].join("\n");
}
