import { expect, test } from "vitest";
import { resolveQueueCapability } from "./queue-capability";

test("only established connected Host info chooses a queue owner", () => {
  expect(resolveQueueCapability({ connected: true, serverInfo: undefined })).toBe("unknown");
  for (const connected of [false, true]) {
    expect(
      resolveQueueCapability({ connected, serverInfo: { features: { hostInputQueue: true } } }),
    ).toBe(connected ? "host" : "unknown");
    for (const serverInfo of [{}, { features: {} }, { features: { hostInputQueue: false } }])
      expect(resolveQueueCapability({ connected, serverInfo })).toBe(
        connected ? "client" : "unknown",
      );
  }
});
