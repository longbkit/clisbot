import { beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ enabled: false, begin: vi.fn(), end: vi.fn() }));
vi.mock("@/constants/build-profile", () => ({
  get isProfileBuild() {
    return env.enabled;
  },
  isSyntheticReactProfileBuild: false,
}));
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => ({ beginSection: env.begin, endSection: env.end }),
}));
import { traceConversationFetch } from "./native-trace";
import { traceConversationFetch as webFetch } from "./conversation-trace";
beforeEach(() => {
  env.enabled = false;
  env.begin.mockClear();
  env.end.mockClear();
});
it("production and web do not activate payload accounting", () => {
  expect(traceConversationFetch("private-route", "tail")).toBeUndefined();
  expect(webFetch("private-route", "tail")).toBeUndefined();
  expect(env.begin).not.toHaveBeenCalled();
});
it("correlates each profile RPC and reports UTF-8 payload size without its identity or content", () => {
  env.enabled = true;
  const a = traceConversationFetch("private-route", "tail");
  const b = traceConversationFetch("private-route", "after");
  const payload = { lines: [{ text: "private Tiếng Việt 😀" }], error: null };
  a?.(payload);
  b?.({ lines: [], error: null });
  const sections = env.begin.mock.calls.map(([name]) => name as string);
  const invokes = sections.filter((name) => name.startsWith("clisbot.chat.fetch.invoke"));
  const responses = sections.filter((name) => name.startsWith("clisbot.chat.fetch.response"));
  expect(invokes).toHaveLength(2);
  const token = (name: string) => /request=([^;]+)/.exec(name)?.[1];
  expect(token(invokes[0]!)).not.toBe(token(invokes[1]!));
  expect(token(responses[0]!)).toBe(token(invokes[0]!));
  expect(token(responses[1]!)).toBe(token(invokes[1]!));
  expect(responses[0]).toContain(
    `bytes=${new TextEncoder().encode(JSON.stringify(payload)).length}`,
  );
  expect(sections.every((name) => name.length < 127 && !name.includes("private"))).toBe(true);
});
