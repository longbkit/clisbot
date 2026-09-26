import { describe, expect, it } from "vitest";
import { createMessageAttempt } from "./message-attempt";
describe("chat send receipts", () => {
  it("reuses the id after an ambiguous timeout, then permits an intentional identical message", () => {
    let n = 0;
    const attempt = createMessageAttempt(() => `message-${++n}`);
    expect(attempt.forText("hello")).toBe("message-1");
    expect(attempt.forText("hello")).toBe("message-1");
    attempt.accepted("message-1");
    expect(attempt.forText("hello")).toBe("message-2");
  });
  it("does not settle another pending message", () => {
    let n = 0;
    const attempt = createMessageAttempt(() => `${++n}`);
    const first = attempt.forText("one");
    const second = attempt.forText("two");
    attempt.accepted(first);
    expect(attempt.forText("two")).toBe(second);
  });
});
