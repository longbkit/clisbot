// Tests for the channel control-plane kill-switch predicate (plan §14.8 /
// impl doc §4.5). Pure env-reading logic, so no hooks or loader are involved.

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { assertChannelsEnabled, ChannelsDisabledError, isChannelsEnabled } from "./channel-gate.js";

const KEY = "PASEO_HUB_CHANNELS_ENABLED";

describe("isChannelsEnabled", () => {
  it("is enabled by default (key unset)", () => {
    assert.equal(isChannelsEnabled({}), true);
  });

  it("is enabled for a truthy value", () => {
    for (const value of ["1", "true", "yes", "on", "2"]) {
      assert.equal(isChannelsEnabled({ [KEY]: value }), true, `expected ${value} enabled`);
    }
  });

  it("is disabled for an explicit off value (case- and whitespace-insensitive)", () => {
    for (const value of ["0", "false", "no", "off", "OFF", "off ", " 0", "False"]) {
      assert.equal(isChannelsEnabled({ [KEY]: value }), false, `expected ${value} disabled`);
    }
  });

  it("reads the internal (non-alias) env name", () => {
    // The CLISBOT_* operator alias is resolved to PASEO_HUB_* by env-alias.ts at
    // process entry; the gate reads only the internal name.
    assert.equal(isChannelsEnabled({ CLISBOT_HUB_CHANNELS_ENABLED: "0", [KEY]: "1" }), true);
  });
});

describe("assertChannelsEnabled", () => {
  it("passes when enabled", () => {
    assertChannelsEnabled({ [KEY]: "1" });
    assertChannelsEnabled({});
  });

  it("throws a typed error when disabled", () => {
    assert.throws(
      () => assertChannelsEnabled({ [KEY]: "0" }),
      (error: unknown) => error instanceof ChannelsDisabledError && /disabled/u.test(error.message),
    );
  });
});
