// Replays the recorded differential corpus against the local Slack pure
// functions. A failure here means a ported function changed behaviour since
// the corpus was recorded — regenerate with
// `node --import tsx scripts/channel-differential-fixtures.mjs generate --pkg slack`
// only after you have decided the new behaviour is correct.
import { describe, expect, it } from "vitest";
import { readDifferentialCorpus, replayDifferentialCorpus } from "@getpaseo/channels-shared";
import { slackDifferentialCases } from "./__fixtures__/upstream-differential.cases.js";

const corpus = readDifferentialCorpus(
  new URL("./__fixtures__/upstream-differential.json", import.meta.url),
);

describe("Slack upstream differential corpus", () => {
  it("was recorded against the ported upstream baseline", () => {
    expect(corpus.channel).toBe("slack");
    expect(corpus.upstreamCommit).toBe("5d8067a4483");
    expect(corpus.cases.length).toBeGreaterThan(0);
  });

  it("names an upstream test file for every case", () => {
    const orphans = corpus.cases.filter(
      (fixture) => !fixture.upstreamTestFile.startsWith("extensions/slack/"),
    );
    expect(orphans).toEqual([]);
  });

  it("reproduces every recorded output", () => {
    expect(replayDifferentialCorpus(corpus, slackDifferentialCases)).toEqual([]);
  });
});
