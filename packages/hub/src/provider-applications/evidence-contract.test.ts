import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "vitest";

const SPECS = ["e2e/apps.spec.ts", "e2e/apps-mobile.spec.ts"];
const INTERACTION = /\.(?:collapse|expand|fill|save|click)\(/u;

async function specSources(): Promise<readonly string[]> {
  return await Promise.all(SPECS.map((path) => readFile(path, "utf8")));
}

/** Everything between one `test(` and the next, which is close enough to a test body to reason about. */
function testBlocks(source: string): readonly string[] {
  return source.split(/\btest\(/u).slice(1);
}

describe("operator app screenshot evidence", () => {
  it("has exactly one writer for every evidence filename", async () => {
    const writers: string[] = [];
    for (const source of await specSources()) {
      for (const match of source.matchAll(/\.shoot\(SHOTS, "([^"]+)"\)/gu)) {
        writers.push(match[1]!);
      }
    }

    assert.equal(new Set(writers).size, writers.length);
  });

  it("shoots the untouched chooser before anything on it has been touched", async () => {
    const shots: string[] = [];
    for (const source of await specSources()) {
      for (const block of testBlocks(source)) {
        const shot = /\.shoot\(SHOTS, "(apps-01-chooser\.[a-z]+)"\)/u.exec(block);
        if (shot === null) continue;
        shots.push(shot[1]!);
        // A chooser shot that needed a `collapse()` first is a picture of a different screen.
        const touched = INTERACTION.exec(block.slice(0, shot.index));
        assert.equal(
          touched,
          null,
          `${shot[1]} is taken after ${touched?.[0]} — that is not the first load`,
        );
      }
    }

    assert.deepEqual(shots.sort(), ["apps-01-chooser.desktop", "apps-01-chooser.mobile"]);
  });
});
