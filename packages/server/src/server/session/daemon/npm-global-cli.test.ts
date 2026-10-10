import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DefaultNpmGlobalClisbotCli } from "./npm-global-cli.js";

interface CommandCall {
  command: string;
  args: string[];
  timeout?: number;
  maxBuffer?: number;
}

const globalRoot = path.join(path.sep, "global", "lib");

interface GlobalInstall {
  root: string;
  packagePath: string;
  // npm 7+ `ls --json --long` marks neither kind of install with a link flag.
  npmLsJson: string;
}

describe("DefaultNpmGlobalClisbotCli", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createGlobalInstall(options: { linked: boolean }): GlobalInstall {
    const dir = mkdtempSync(path.join(tmpdir(), "clisbot-npm-global-"));
    tempDirs.push(dir);
    const root = path.join(dir, "prefix", "lib");
    const packagePath = path.join(root, "node_modules", "clisbot");
    const checkoutCli = path.join(dir, "checkout", "packages", "cli");
    if (options.linked) {
      mkdirSync(checkoutCli, { recursive: true });
      mkdirSync(path.dirname(packagePath), { recursive: true });
      symlinkSync(checkoutCli, packagePath, "junction");
    } else {
      mkdirSync(packagePath, { recursive: true });
    }
    const npmLsJson = JSON.stringify({
      name: "lib",
      path: root,
      dependencies: {
        clisbot: {
          version: "0.1.15",
          resolved: options.linked
            ? `file:${path.relative(root, checkoutCli)}`
            : "https://registry.npmjs.org/clisbot/-/clisbot-0.1.15.tgz",
          path: packagePath,
        },
      },
    });
    return { root, packagePath, npmLsJson };
  }

  test("reports a global install linked to a local checkout as linked", async () => {
    const install = createGlobalInstall({ linked: true });
    const cli = new DefaultNpmGlobalClisbotCli(async () => ({
      exitCode: 0,
      stdout: install.npmLsJson,
      stderr: "",
    }));

    await expect(cli.inspect()).resolves.toMatchObject({ isLinked: true });
  });

  test("inspects the npm global cli install with npm -g ls", async () => {
    const install = createGlobalInstall({ linked: false });
    const calls: CommandCall[] = [];
    const cli = new DefaultNpmGlobalClisbotCli(async (command, args, options) => {
      calls.push({
        command,
        args,
        timeout: options?.timeout,
        maxBuffer: options?.maxBuffer,
      });
      return { exitCode: 0, stdout: install.npmLsJson, stderr: "" };
    });

    await expect(cli.inspect()).resolves.toEqual({
      version: "0.1.15",
      packagePath: install.packagePath,
      globalRootPath: install.root,
      isLinked: false,
    });
    expect(calls).toEqual([
      {
        command: "npm",
        args: ["-g", "ls", "clisbot", "--json", "--depth=0", "--long"],
        timeout: 10_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    ]);
  });

  test("runs the global install command for the latest cli", async () => {
    const calls: CommandCall[] = [];
    const cli = new DefaultNpmGlobalClisbotCli(async (command, args, options) => {
      calls.push({
        command,
        args,
        timeout: options?.timeout,
        maxBuffer: options?.maxBuffer,
      });
      return { exitCode: 0, stdout: "changed 42 packages", stderr: "" };
    });

    await expect(cli.installLatest()).resolves.toEqual({
      exitCode: 0,
      stdout: "changed 42 packages",
      stderr: "",
    });
    expect(calls).toEqual([
      {
        command: "npm",
        args: ["install", "-g", "clisbot@latest"],
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    ]);
  });

  test("reports missing npm when npm exits without JSON", async () => {
    const cli = new DefaultNpmGlobalClisbotCli(async () => ({
      exitCode: 127,
      stdout: "",
      stderr: "npm: command not found",
    }));

    await expect(cli.inspect()).rejects.toThrow("npm: command not found");
  });

  test("reports missing global cli when npm output has no cli dependency", async () => {
    const cli = new DefaultNpmGlobalClisbotCli(async () => ({
      exitCode: 1,
      stdout: JSON.stringify({ name: "lib", path: globalRoot, dependencies: {} }),
      stderr: "missing",
    }));

    await expect(cli.inspect()).rejects.toThrow(
      "clisbot is not installed with npm -g on this host",
    );
  });
});
