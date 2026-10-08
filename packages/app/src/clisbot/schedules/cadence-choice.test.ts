import { describe, expect, it } from "vitest";
import { choiceError, choiceFromCron, cronFromChoice, parseTime } from "./cadence-choice";

describe("cadence choice", () => {
  it("reads the cadences people ask for and writes the same cron back", () => {
    const cases: [string, Partial<ReturnType<typeof choiceFromCron>>][] = [
      ["*/5 * * * *", { mode: "every", amount: "5", unit: "minutes" }],
      ["* * * * *", { mode: "every", amount: "1", unit: "minutes" }],
      ["0 * * * *", { mode: "every", amount: "1", unit: "hours" }],
      ["0 */3 * * *", { mode: "every", amount: "3", unit: "hours" }],
      ["0 7 * * *", { mode: "daily", time: "07:00" }],
      ["30 7 * * 1", { mode: "weekly", time: "07:30", days: [1] }],
      ["0 9 * * 1-5", { mode: "weekly", time: "09:00", days: [1, 2, 3, 4, 5] }],
      ["0 9 * * 0,6", { mode: "weekly", time: "09:00", days: [0, 6] }],
    ];
    for (const [cron, expected] of cases) {
      const choice = choiceFromCron(cron);
      expect(choice).toMatchObject(expected);
      expect(cronFromChoice(choice)).toBe(cron);
    }
  });

  it("keeps anything else as Custom, unchanged", () => {
    for (const cron of ["0 9 1 1 *", "15 */2 * * *", "0 9 * * MON", "nonsense"]) {
      const choice = choiceFromCron(cron);
      expect(choice.mode).toBe("custom");
      expect(cronFromChoice(choice)).toBe(cron);
    }
  });

  it("refuses an incomplete choice instead of guessing", () => {
    const every = { ...choiceFromCron("*/5 * * * *") };
    expect(choiceError({ ...every, amount: "0" })).toBe("amount");
    expect(choiceError({ ...every, amount: "90" })).toBe("amount");
    // 7 does not divide an hour, so */7 would not run every 7 minutes.
    expect(choiceError({ ...every, amount: "7" })).toBe("amount");
    expect(choiceError({ ...every, amount: "15", unit: "hours" })).toBe("amount");
    expect(cronFromChoice({ ...every, amount: "abc" })).toBeNull();
    const weekly = choiceFromCron("0 7 * * 1");
    expect(choiceError({ ...weekly, days: [] })).toBe("days");
    expect(choiceError({ ...weekly, time: "25:00" })).toBe("time");
  });

  it("accepts the ways people type a time", () => {
    expect(parseTime("7")).toEqual({ hour: 7, minute: 0 });
    expect(parseTime("7:30")).toEqual({ hour: 7, minute: 30 });
    expect(parseTime("07.05")).toEqual({ hour: 7, minute: 5 });
    expect(parseTime("7h30")).toEqual({ hour: 7, minute: 30 });
    expect(parseTime("24:00")).toBeNull();
  });
});
