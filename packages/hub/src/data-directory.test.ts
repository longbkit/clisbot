import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { describe, it } from "vitest";
import { resolveHubDataDirectory } from "./data-directory.js";

describe("Hub data directory", () => {
  it("stores Hub data under XDG_DATA_HOME", () => {
    const dataHome = resolve("fixtures", "xdg-data");
    assert.equal(
      resolveHubDataDirectory({
        environment: { XDG_DATA_HOME: dataHome },
        homeDirectory: resolve("fixtures", "home"),
        workingDirectory: resolve("fixtures", "work"),
      }),
      join(dataHome, "paseo-hub"),
    );
  });

  it("uses the XDG default when XDG_DATA_HOME is absent, empty, or relative", () => {
    const homeDirectory = resolve("fixtures", "home");
    for (const xdgDataHome of [undefined, "", "relative/data"]) {
      assert.equal(
        resolveHubDataDirectory({
          environment: { XDG_DATA_HOME: xdgDataHome },
          homeDirectory,
          workingDirectory: resolve("fixtures", "work"),
        }),
        join(homeDirectory, ".local", "share", "paseo-hub"),
      );
    }
  });

  it("keeps every defined PASEO_HUB_DATA_DIR as an explicit override", () => {
    const explicitDirectory = resolve("fixtures", "explicit-data");
    const workingDirectory = resolve("fixtures", "work");
    assert.equal(
      resolveHubDataDirectory({
        environment: {
          PASEO_HUB_DATA_DIR: explicitDirectory,
          XDG_DATA_HOME: resolve("fixtures", "xdg-data"),
        },
        homeDirectory: resolve("fixtures", "home"),
        workingDirectory,
      }),
      explicitDirectory,
    );
    assert.equal(
      resolveHubDataDirectory({
        environment: {
          PASEO_HUB_DATA_DIR: "var/paseo-hub",
          XDG_DATA_HOME: resolve("fixtures", "xdg-data"),
        },
        homeDirectory: resolve("fixtures", "home"),
        workingDirectory,
      }),
      join(workingDirectory, "var", "paseo-hub"),
    );
    assert.equal(
      resolveHubDataDirectory({
        environment: {
          PASEO_HUB_DATA_DIR: "",
          XDG_DATA_HOME: resolve("fixtures", "xdg-data"),
        },
        homeDirectory: resolve("fixtures", "home"),
        workingDirectory,
      }),
      workingDirectory,
    );
  });
});
