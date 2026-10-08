import { describe, expect, it } from "vitest";
import { runLimitError, runLimitErrorForUpdate, runsMoreThanDaily } from "./run-limit.js";

const cron = (expression: string) => ({ type: "cron" as const, expression });

describe("runsMoreThanDaily", () => {
  it("counts intervals under a day and crons with more than one time of day", () => {
    expect(runsMoreThanDaily({ type: "every", everyMs: 5 * 60_000 })).toBe(true);
    expect(runsMoreThanDaily({ type: "every", everyMs: 24 * 3_600_000 })).toBe(false);
    expect(runsMoreThanDaily(cron("*/5 * * * *"))).toBe(true);
    expect(runsMoreThanDaily(cron("0 * * * *"))).toBe(true);
    expect(runsMoreThanDaily(cron("0 9,17 * * *"))).toBe(true);
    expect(runsMoreThanDaily(cron("0 7 * * *"))).toBe(false);
    expect(runsMoreThanDaily(cron("0 9 * * 1-5"))).toBe(false);
    expect(runsMoreThanDaily(cron("0 9 1 1 *"))).toBe(false);
    expect(runsMoreThanDaily(cron("*/30 7 * * *"))).toBe(true);
    expect(runsMoreThanDaily(cron("0 */24 * * *"))).toBe(false);
  });

  it("asks for Max runs only when the cadence needs one", () => {
    expect(runLimitError(cron("*/5 * * * *"), null)).toMatch(/Max runs/);
    expect(runLimitError(cron("*/5 * * * *"), 10)).toBeNull();
    expect(runLimitError(cron("0 7 * * *"), null)).toBeNull();
  });
});

describe("runLimitErrorForUpdate", () => {
  const older = { cadence: cron("*/5 * * * *"), maxRuns: null };

  it("leaves an older schedule alone unless the cadence or Max runs change", () => {
    expect(runLimitErrorForUpdate(older, {})).toBeNull();
    expect(runLimitErrorForUpdate(older, { maxRuns: null })).toMatch(/Max runs/);
    expect(runLimitErrorForUpdate(older, { cadence: cron("*/10 * * * *") })).toMatch(/Max runs/);
    expect(runLimitErrorForUpdate(older, { cadence: cron("0 7 * * *") })).toBeNull();
  });

  it("checks a new cadence against the stored Max runs", () => {
    const daily = { cadence: cron("0 7 * * *"), maxRuns: 5 };
    expect(runLimitErrorForUpdate(daily, { cadence: cron("0 * * * *") })).toBeNull();
    expect(
      runLimitErrorForUpdate({ ...daily, maxRuns: null }, { cadence: cron("0 * * * *") }),
    ).toMatch(/Max runs/);
  });
});
