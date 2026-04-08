import { describe, expect, test } from "bun:test";
import { MissingEnvVarError, resolveConfigEnvVars } from "../src/config/env-substitution.ts";

describe("resolveConfigEnvVars", () => {
  test("substitutes nested env placeholders", () => {
    const resolved = resolveConfigEnvVars(
      {
        token: "${TOKEN}",
        nested: {
          list: ["${VALUE}"],
        },
      },
      {
        TOKEN: "abc",
        VALUE: "123",
      },
    );

    expect(resolved).toEqual({
      token: "abc",
      nested: {
        list: ["123"],
      },
    });
  });

  test("throws when env var is missing", () => {
    expect(() =>
      resolveConfigEnvVars(
        {
          token: "${TOKEN}",
        },
        {},
      )).toThrow(MissingEnvVarError);
  });
});
