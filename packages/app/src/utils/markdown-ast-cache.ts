import type MarkdownIt from "markdown-it";
import { parser as markdownToRendered, type ASTNode } from "react-native-markdown-display";

// Bounded by source size: a long transcript keeps its recent replies parsed, not every reply ever seen.
const MAX_CACHED_SOURCE_CHARS = 2_000_000;

interface AstCache {
  entries: Map<string, ASTNode[]>;
  chars: number;
}

const caches = new WeakMap<MarkdownIt, AstCache>();

/** Opt a parser into tree reuse. Only parsers whose output depends on the source alone qualify. */
export function cacheMarkdownAst<T extends MarkdownIt>(parser: T): T {
  if (!caches.has(parser)) caches.set(parser, { entries: new Map(), chars: 0 });
  return parser;
}

/**
 * The renderer's tree for `source`, parsed once per opted-in parser. Remounting a reply (Back, then
 * the same chat again) skips markdown-it and token cleanup; the renderer reads trees without mutating
 * them, so one tree can back any number of mounts. Other parsers get the source back unchanged.
 */
export function readMarkdownAst(parser: MarkdownIt, source: string): ASTNode[] | string {
  const cache = caches.get(parser);
  if (!cache || source.length > MAX_CACHED_SOURCE_CHARS) return source;
  const cached = cache.entries.get(source);
  if (cached) {
    cache.entries.delete(source);
    cache.entries.set(source, cached);
    return cached;
  }
  // The package's renderer argument receives the finished tree; returning it skips rendering.
  const tree = markdownToRendered(
    source,
    ((nodes: ASTNode[]) => nodes) as never,
    parser,
  ) as ASTNode[];
  cache.entries.set(source, tree);
  cache.chars += source.length;
  for (const [key] of cache.entries) {
    if (cache.chars <= MAX_CACHED_SOURCE_CHARS) break;
    cache.entries.delete(key);
    cache.chars -= key.length;
  }
  return tree;
}
