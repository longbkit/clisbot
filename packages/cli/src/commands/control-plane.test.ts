import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { HubCommandError } from "./hub/error.js";
import {
  controlPlaneRequest,
  extractControlPlaneOptions,
  isControlPlaneAbsent,
  requiredStringOption,
  resolveControlPlaneTarget,
  stringOption,
} from "./control-plane.js";

const tempRoots: string[] = [];

async function createHome(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "clisbot-control-plane-"));
  tempRoots.push(root);
  const home = path.join(root, ".clisbot");
  await mkdir(home, { recursive: true });
  return home;
}

function writeHubState(home: string, pid: number, port = 6868): void {
  writeFileSync(
    path.join(home, "hub-local.json"),
    JSON.stringify({ version: 1, url: `http://127.0.0.1:${port}`, port, pid }),
  );
}

function esrchError(): NodeJS.ErrnoException {
  const error = new Error("process.kill(pid) ESRCH: no such process") as NodeJS.ErrnoException;
  error.code = "ESRCH";
  return error;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("resolveControlPlaneTarget", () => {
  test("an explicit --hub origin targets that Hub remotely with the given API key", () => {
    const target = resolveControlPlaneTarget({
      hub: "https://hub.example.com",
      apiKey: "team-key",
    });
    expect(target).toEqual({
      origin: "https://hub.example.com",
      apiKey: "team-key",
      source: "remote",
    });
  });

  test("a blank --hub falls back to local discovery", async () => {
    const home = await createHome();
    writeHubState(home, process.pid);
    const target = resolveControlPlaneTarget({ hub: "  ", home });
    expect(target).toEqual({ origin: "http://127.0.0.1:6868", source: "local" });
    expect(target.apiKey).toBeUndefined();
  });

  test("a recorded, live local Hub resolves to its loopback URL without an API key", async () => {
    const home = await createHome();
    writeHubState(home, process.pid, 6900);
    const target = resolveControlPlaneTarget({}, { PASEO_HOME: home } as NodeJS.ProcessEnv);
    expect(target.origin).toBe("http://127.0.0.1:6900");
    expect(target.source).toBe("local");
  });

  test("a stale state file names the dead PID and points at hub start", async () => {
    const home = await createHome();
    writeHubState(home, 4242);
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw esrchError();
    });
    expect(() => resolveControlPlaneTarget({ home })).toThrowError(HubCommandError);
    try {
      resolveControlPlaneTarget({ home });
      expect.unreachable();
    } catch (error) {
      expect((error as HubCommandError).code).toBe("HUB_NOT_RUNNING");
      expect((error as HubCommandError).message).toContain("4242");
      expect((error as HubCommandError).message).toContain("clisbot hub start");
    }
  });

  test("no state file at all reports that no local Hub is running", async () => {
    const home = await createHome();
    try {
      resolveControlPlaneTarget({ home });
      expect.unreachable();
    } catch (error) {
      expect((error as HubCommandError).code).toBe("HUB_NOT_RUNNING");
      expect((error as HubCommandError).message).toContain("No local Hub is running");
      expect((error as HubCommandError).message).toContain("clisbot hub start");
      expect((error as HubCommandError).message).toContain("--hub");
    }
  });
});

describe("isControlPlaneAbsent", () => {
  test("recognizes the plain-404 transport failure", () => {
    const error = new HubCommandError(
      "HUB_REQUEST_FAILED",
      "Hub channel add failed with HTTP 404.",
    );
    expect(isControlPlaneAbsent(error)).toBe(true);
  });

  test("recognizes a conforming 404 problem body", () => {
    expect(isControlPlaneAbsent(new HubCommandError("HUB_NOT_FOUND", "Not Found"))).toBe(true);
  });

  test("does not classify non-404 Hub failures", () => {
    const error = new HubCommandError("HUB_VALIDATION_FAILED", "invalid configuration");
    expect(isControlPlaneAbsent(error)).toBe(false);
  });

  test("does not classify unrelated errors", () => {
    expect(isControlPlaneAbsent(new Error("boom"))).toBe(false);
    expect(isControlPlaneAbsent(undefined)).toBe(false);
  });
});

describe("controlPlaneRequest", () => {
  test("translates a 404 into the missing control-plane message", async () => {
    const request = () => Promise.reject(new HubCommandError("HUB_NOT_FOUND", "Not Found"));
    await expect(controlPlaneRequest(request)).rejects.toMatchObject({
      code: "HUB_NOT_FOUND",
      message: expect.stringContaining("does not expose the channel control plane"),
    });
    const plain404 = () =>
      Promise.reject(
        new HubCommandError("HUB_REQUEST_FAILED", "Hub channel listing failed with HTTP 404."),
      );
    await expect(controlPlaneRequest(plain404)).rejects.toMatchObject({
      code: "HUB_NOT_FOUND",
      message: expect.stringContaining("/api/v1/channels and /api/v1/users are absent"),
    });
  });

  test("passes non-404 failures through unchanged", async () => {
    const error = new HubCommandError("HUB_VALIDATION_FAILED", "invalid configuration");
    await expect(controlPlaneRequest(() => Promise.reject(error))).rejects.toBe(error);
  });

  test("resolves successes", async () => {
    await expect(controlPlaneRequest(() => Promise.resolve("ok"))).resolves.toBe("ok");
  });
});

describe("command option helpers", () => {
  const options = { hub: "https://hub.example.com", home: "/h", apiKey: "k", blank: "  " };

  test("extractControlPlaneOptions trims blanks to undefined", () => {
    expect(extractControlPlaneOptions(options)).toEqual({
      hub: "https://hub.example.com",
      home: "/h",
      apiKey: "k",
    });
  });

  test("stringOption returns non-blank values only", () => {
    expect(stringOption(options, "apiKey")).toBe("k");
    expect(stringOption(options, "blank")).toBeUndefined();
    expect(stringOption(options, "absent")).toBeUndefined();
  });

  test("requiredStringOption throws for missing or blank values", () => {
    expect(requiredStringOption(options, "apiKey")).toBe("k");
    expect(() => requiredStringOption(options, "absent")).toThrowError(
      expect.objectContaining({ code: "MISSING_OPTION" }),
    );
    expect(() => requiredStringOption(options, "blank")).toThrowError(
      expect.objectContaining({ code: "MISSING_OPTION" }),
    );
  });

  test("kebab-case flag names resolve to commander's camelCase keys", () => {
    const kebab = { "secret-file": undefined, secretFile: "/tmp/secret.json" };
    expect(stringOption(kebab, "secret-file")).toBe("/tmp/secret.json");
    expect(requiredStringOption(kebab, "secret-file")).toBe("/tmp/secret.json");
    expect(stringOption({ "secret-file": undefined }, "secret-file")).toBeUndefined();
    expect(() => requiredStringOption({ secretFile: "  " }, "secret-file")).toThrowError(
      expect.objectContaining({ code: "MISSING_OPTION" }),
    );
  });
});
