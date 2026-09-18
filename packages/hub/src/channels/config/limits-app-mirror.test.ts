// The app cannot import the Hub, so it mirrors the limit names and the
// open-audience defaults. This test reads the app's source and fails when the
// two drift apart.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { CHANNEL_LIMIT_NAMES, OPEN_AUDIENCE_ROUTE_LIMITS } from "./schema.js";

const APP_SOURCE = readFileSync(
  fileURLToPath(
    new URL("../../../../app/src/clisbot/hub/channel-configuration.ts", import.meta.url),
  ),
  "utf8",
);

/** The body of `export const NAME ... = <open>…<close>` in the app source. */
function appConstant(name: string, open: string, close: string): string {
  const start = APP_SOURCE.indexOf(`export const ${name}`);
  assert.ok(start >= 0, `${name} is missing from the app`);
  const from = APP_SOURCE.indexOf(open, APP_SOURCE.indexOf("=", start));
  return APP_SOURCE.slice(from + 1, APP_SOURCE.indexOf(close, from));
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

/** `15 * 60` or `8_000` as a number. */
function product(expression: string): number {
  return expression
    .split("*")
    .map((factor) => Number(factor.trim().replaceAll("_", "")))
    .reduce((left, right) => left * right, 1);
}
