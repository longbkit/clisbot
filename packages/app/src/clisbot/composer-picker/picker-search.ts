import type { ProviderSelectionModelRow } from "@/provider-selection/provider-selection";

/**
 * How well a row matches, best first: the whole query, a prefix of the name, the start of a word
 * (or of a run of words read without separators, so `gpt6` finds GPT-6), anywhere in a word.
 */
export type MatchTier = 0 | 1 | 2 | 3;
export const MATCH_EXACT: MatchTier = 0;
export const MATCH_PREFIX: MatchTier = 1;
export const MATCH_WORD_PREFIX: MatchTier = 2;
export const MATCH_SUBSTRING: MatchTier = 3;

/** A run of characters in the original label, `end` exclusive. */
export interface TextRange {
  start: number;
  end: number;
}

export interface RowMatch {
  tier: MatchTier;
  /** The model label's matched characters, to draw in bold. */
  ranges: TextRange[];
}

/** A query read for matching: its words and the same characters without separators. */
export interface SearchQuery {
  tokens: string[];
  compact: string;
}

/** Text folded for matching, with each character's index in the original. */
interface FoldedText {
  text: string;
  source: number[];
  /** Index in `text` where each word starts. */
  wordStarts: number[];
  /** `text` without its spaces, and each character's index in `text`. */
  compact: string;
  compactIndex: number[];
  /** Indexes in `text` of words that continue a number: the `6` of `5.6`. */
  numberTails: ReadonlySet<number>;
}

const SEPARATOR = /[\s\-._/]/u;
const SPACE = /\s/u;
const DIGIT = /\d/u;
const COMBINING_MARK = /\p{M}/gu;

function foldCharacter(character: string): string {
  return character.normalize("NFD").replace(COMBINING_MARK, "").toLowerCase().replace(/đ/gu, "d");
}

function foldText(value: string): FoldedText {
  let text = "";
  const source: number[] = [];
  const numberTails = new Set<number>();
  // One separator that is not a space, between digits, keeps a number whole: 5.6, gpt-5-6.
  let joined = false;
  let index = 0;
  for (const character of value) {
    if (SEPARATOR.test(character)) {
      const afterDigit = DIGIT.test(text.at(-1) ?? "");
      if (text.length > 0 && !text.endsWith(" ")) {
        joined = afterDigit && !SPACE.test(character);
        text += " ";
        source.push(index);
      } else {
        joined = false;
      }
    } else {
      if (joined && DIGIT.test(character)) numberTails.add(text.length);
      joined = false;
      for (const folded of foldCharacter(character)) {
        text += folded;
        source.push(index);
      }
    }
    index += character.length;
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    source.pop();
  }
  return indexWords(text, source, numberTails);
}

function indexWords(text: string, source: number[], numberTails: ReadonlySet<number>): FoldedText {
  const wordStarts: number[] = [];
  let compact = "";
  const compactIndex: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === " ") continue;
    if (i === 0 || text[i - 1] === " ") wordStarts.push(i);
    compact += text[i];
    compactIndex.push(i);
  }
  return { text, source, wordStarts, compact, compactIndex, numberTails };
}

/**
 * Splits a query into words: lowercase, accents gone, `-` `.` `_` `/` and spaces separate. A
 * number stays one word, so `5.6` looks for that number and not for a 5 and a 6.
 */
export function parseSearchQuery(query: string): SearchQuery {
  const folded = foldText(query);
  const tokens: string[] = [];
  folded.wordStarts.forEach((start, index) => {
    const end = folded.wordStarts[index + 1] ?? folded.text.length + 1;
    const word = folded.text.slice(start, end - 1);
    const previous = tokens.at(-1);
    if (folded.numberTails.has(start) && previous !== undefined) {
      tokens[tokens.length - 1] = previous + word;
    } else {
      tokens.push(word);
    }
  });
  return { tokens, compact: folded.compact };
}

interface TokenHit {
  tier: MatchTier;
  /** Indexes into the folded text. */
  positions: number[];
}

function range(from: number, length: number): number[] {
  return Array.from({ length }, (_, offset) => from + offset);
}

/**
 * Whether a number can begin here. `gpt 6` must not find GPT-5.6: the 6 there is the end of a
 * number, not a number of its own.
 */
function startsNumber(field: FoldedText, at: number): boolean {
  return !field.numberTails.has(at) && !DIGIT.test(field.text[at - 1] ?? "");
}

function wordPrefixHit(field: FoldedText, token: string, numeric: boolean): TokenHit | null {
  for (const start of field.wordStarts) {
    if (numeric && !startsNumber(field, start)) continue;
    if (field.text.startsWith(token, start)) {
      return { tier: MATCH_WORD_PREFIX, positions: range(start, token.length) };
    }
    // Read without separators from this word on: `gpt6` covers "gpt 6", `opus55` "opus 5 5".
    const compactStart = field.compactIndex.indexOf(start);
    if (field.compact.startsWith(token, compactStart)) {
      const positions = range(compactStart, token.length).map((at) => field.compactIndex[at]);
      return { tier: MATCH_WORD_PREFIX, positions };
    }
  }
  return null;
}

function occurrences(text: string, token: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(token); at >= 0; at = text.indexOf(token, at + 1)) found.push(at);
  return found;
}

function tokenHit(field: FoldedText, token: string): TokenHit | null {
  const numeric = DIGIT.test(token[0] ?? "");
  const wordHit = wordPrefixHit(field, token, numeric);
  if (wordHit) return wordHit;
  const at = occurrences(field.text, token).find((index) => !numeric || startsNumber(field, index));
  return at === undefined ? null : { tier: MATCH_SUBSTRING, positions: range(at, token.length) };
}

/** Folded text indexes back to merged runs of the original string. */
function toRanges(field: FoldedText, positions: Iterable<number>): TextRange[] {
  const sourceIndexes = [...new Set([...positions].map((at) => field.source[at]))].sort(
    (a, b) => a - b,
  );
  const ranges: TextRange[] = [];
  for (const index of sourceIndexes) {
    const last = ranges.at(-1);
    if (last && last.end === index) last.end = index + 1;
    else ranges.push({ start: index, end: index + 1 });
  }
  return ranges;
}

interface RowFields {
  label: FoldedText;
  model: FoldedText[];
  all: FoldedText[];
}

function foldRow(row: ProviderSelectionModelRow): RowFields {
  const label = foldText(row.modelLabel);
  const model = [label, foldText(row.modelId)];
  return { label, model, all: [...model, foldText(row.providerLabel), foldText(row.provider)] };
}

/** The whole query against the model's own name or id: exact, then prefix. */
function wholeQueryMatch(fields: RowFields, query: SearchQuery): RowMatch | null {
  const { compact } = query;
  const labelPrefix = fields.label.compact.startsWith(compact);
  const ranges = labelPrefix
    ? toRanges(
        fields.label,
        range(0, compact.length).map((at) => fields.label.compactIndex[at]),
      )
    : [];
  if (fields.model.some((field) => field.compact === compact)) {
    return { tier: MATCH_EXACT, ranges };
  }
  if (fields.model.some((field) => field.compact.startsWith(compact))) {
    return { tier: MATCH_PREFIX, ranges };
  }
  return null;
}

/**
 * Every word of the query must match the model's name, id or provider, in any order; the row
 * ranks by its weakest word. A provider name matches at word-prefix best, so `codex` lists every
 * Codex model without ranking them above a model named so.
 */
export function matchRow(row: ProviderSelectionModelRow, query: SearchQuery): RowMatch | null {
  if (query.tokens.length === 0) return null;
  const fields = foldRow(row);
  const whole = wholeQueryMatch(fields, query);
  if (whole) return whole;
  let tier: MatchTier = MATCH_WORD_PREFIX;
  const labelPositions: number[] = [];
  for (const token of query.tokens) {
    const hits = fields.all.map((field) => tokenHit(field, token));
    const best = hits.reduce<TokenHit | null>(
      (winner, hit) => (hit && (!winner || hit.tier < winner.tier) ? hit : winner),
      null,
    );
    if (!best) return null;
    if (best.tier > tier) tier = best.tier;
    const labelHit = hits[0];
    if (labelHit) labelPositions.push(...labelHit.positions);
  }
  return { tier, ranges: toRanges(fields.label, labelPositions) };
}

export interface RankedRow {
  row: ProviderSelectionModelRow;
  match: RowMatch;
}

/**
 * Matching rows, best tier first; on a tie the current provider's, then favourites, then the
 * catalog's own order.
 */
export function searchRows(input: {
  rows: readonly ProviderSelectionModelRow[];
  query: SearchQuery;
  currentProvider: string;
  favorites: readonly string[];
}): RankedRow[] {
  const ranked = input.rows.flatMap((row, order) => {
    const match = matchRow(row, input.query);
    return match ? [{ row, match, order }] : [];
  });
  function weight(entry: { row: ProviderSelectionModelRow }): number {
    const current = entry.row.provider === input.currentProvider ? 0 : 2;
    const favorite = input.favorites.includes(entry.row.favoriteKey) ? 0 : 1;
    return current + favorite;
  }
  ranked.sort((a, b) => a.match.tier - b.match.tier || weight(a) - weight(b) || a.order - b.order);
  return ranked.map(({ row, match }) => ({ row, match }));
}
