// The app cannot import the Hub, so it mirrors the limit names, the
// open-audience defaults and the tool-activity floor. These tests read the
// app's source and fail when the two drift apart.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { CHANNEL_LIMIT_NAMES, OPEN_AUDIENCE_ROUTE_LIMITS, TOOL_ACTIVITY_FLOOR } from "./schema.js";

function appSource(file: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../../app/src/clisbot/hub/${file}`, import.meta.url)),
    "utf8",
  );
}

const APP_SOURCE = appSource("channel-configuration.ts");
const APP_TOOL_ACTIVITY_SOURCE = appSource("channel-route-tool-activity.ts");

/** The body of `export const NAME ... = <open>…<close>` in an app source file. */
function constantIn(source: string, name: string, open: string, close: string): string {
  const start = source.indexOf(`export const ${name}`);
  assert.ok(start >= 0, `${name} is missing from the app`);
  const from = source.indexOf(open, source.indexOf("=", start));
  return source.slice(from + 1, source.indexOf(close, from));
}

function appConstant(name: string, open: string, close: string): string {
  return constantIn(APP_SOURCE, name, open, close);
}

describe("app mirror of the Channel limits", () => {
  it("lists the same limit names in the same order", () => {
    const names = [...appConstant("CHANNEL_LIMIT_NAMES", "[", "]").matchAll(/"(\w+)"/gu)].map(
      (match) => match[1],
    );
    assert.deepEqual(names, [...CHANNEL_LIMIT_NAMES]);
  });

  it("uses the same open-audience defaults", () => {
    const entries = [
      ...appConstant("DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS", "{", "}").matchAll(
        /(\w+):\s*([\d_]+(?:\s*\*\s*[\d_]+)?)/gu,
      ),
    ].map(([, name, value]) => [name, product(value!)]);
    assert.deepEqual(Object.fromEntries(entries), OPEN_AUDIENCE_ROUTE_LIMITS);
  });
});

describe("app mirror of the tool-activity floor", () => {
  it("uses the same options the Hub applies when nothing is authored", () => {
    // `DEFAULT_TOOL_ACTIVITY` is what the app shows the moment a layer turns
    // tool activity on; the Hub applies the same values on read, so a Route
    // that authors only the switch behaves the way the form said it would.
    const body = constantIn(APP_TOOL_ACTIVITY_SOURCE, "DEFAULT_TOOL_ACTIVITY", "{", "}");
    const entries = [...body.matchAll(/(\w+):\s*(?:"(\w+)"|(\d+))/gu)].map(
      ([, name, text, number]) => [name, text ?? Number(number)],
    );
    const { enabled, ...options } = TOOL_ACTIVITY_FLOOR;
    assert.equal(enabled, false, "the floor is off");
    assert.deepEqual(Object.fromEntries(entries), options);
  });
});

/** `15 * 60` or `8_000` as a number. */
function product(expression: string): number {
  return expression
    .split("*")
    .map((factor) => Number(factor.trim().replaceAll("_", "")))
    .reduce((left, right) => left * right, 1);
}
