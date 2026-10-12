// CommonMark inline code spans across one paragraph (spec 6.1): a run of n
// backticks opens a span that closes at the next run of exactly n backticks,
// even on a later line; shorter or longer runs inside are literal. A run with
// no closer is literal text. A backslash escapes a backtick only outside a span.

/** A protected `[start, end)` column range of one line. */
export type LineRange = readonly [number, number];

function runLength(text: string, at: number): number {
  let end = at;
  while (text[end] === "`") end += 1;
  return end - at;
}

/** The next run of exactly `length` backticks at or after `from`; -1 when none. */
function closingRun(text: string, from: number, length: number): number {
  let index = text.indexOf("`", from);
  while (index >= 0) {
    const run = runLength(text, index);
    if (run === length) return index;
    index = text.indexOf("`", index + run);
  }
  return -1;
}

/** Code-span ranges of the paragraph `text`, as offsets into it. */
function spanRanges(text: string, openToEnd: boolean): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char !== "`") {
      index += 1;
      continue;
    }
    const run = runLength(text, index);
    const close = closingRun(text, index + run, run);
    if (close >= 0) {
      ranges.push([index, close + run]);
      index = close + run;
    } else if (openToEnd) {
      // A draft: the closer may still be streaming, so the rest is code for now.
      ranges.push([index, text.length]);
      return ranges;
    } else {
      index += run;
    }
  }
  return ranges;
}

/**
 * Per line of one paragraph, the column ranges inside code spans. `openToEnd`
 * treats an unclosed run as a span to the end (a streamed draft's last paragraph).
 */
export function paragraphCodeSpans(lines: readonly string[], openToEnd: boolean): LineRange[][] {
  const text = lines.join("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const perLine: LineRange[][] = lines.map(() => []);
  for (const [start, end] of spanRanges(text, openToEnd)) {
    lines.forEach((line, index) => {
      const lineStart = starts[index]!;
      const from = Math.max(start, lineStart) - lineStart;
      const to = Math.min(end, lineStart + line.length) - lineStart;
      if (from < to) perLine[index]!.push([from, to]);
    });
  }
  return perLine;
}
