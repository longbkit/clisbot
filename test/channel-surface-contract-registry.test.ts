import { describe, expect, test } from "bun:test";
import { getChannelSurfaceContract } from "../src/channels/integration/channel-surface-contract-registry.ts";

describe("channel surface contract", () => {
  test("fails loudly for an unsupported channel instead of falling back to slack semantics", () => {
    expect(() => getChannelSurfaceContract("unknown-channel" as any)).toThrow(
      "Unsupported channel surface contract: unknown-channel",
    );
  });
});
