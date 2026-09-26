import { describe, expect, it } from "vitest";
import { createMessageAttempt, createMessageAttemptCache } from "./message-attempt";
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

it("retains ambiguous receipts through a route epoch remount, but isolates replacement identities", () => {
  let n = 0;
  const cache = createMessageAttemptCache(() => `message-${++n}`);
  const client = {};
  const sent = cache.forChat(client, "chat-a").forText("hello");
  // A route remount acquires its controller again from the same connected client.
  expect(cache.forChat(client, "chat-a").forText("hello")).toBe(sent);
  expect(cache.forChat({}, "chat-a").forText("hello")).not.toBe(sent);
  expect(cache.forChat(client, "chat-b").forText("hello")).not.toBe(sent);
  cache.forChat(client, "chat-a").accepted(sent);
  expect(cache.forChat(client, "chat-a").forText("hello")).not.toBe(sent);
});
