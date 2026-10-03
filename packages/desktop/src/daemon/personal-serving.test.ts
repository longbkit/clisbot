import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { readPersistedConfig } from "@clisbot/server/configuration";
import {
  personalDesktopPairing,
  preparePersonalDesktopHome,
  startDesktopHub,
} from "./personal-serving.js";

const cli = vi.hoisted(() => vi.fn());
vi.mock("./cli/external.js", () => ({ runExternalCliJsonCommand: cli }));
const homes: string[] = [];
function home() {
  const value = mkdtempSync(path.join(tmpdir(), "clisbot-desktop-personal-"));
  homes.push(value);
  return value;
}
afterEach(() => {
  cli.mockReset();
  homes.forEach((value) => rmSync(value, { recursive: true, force: true }));
  homes.length = 0;
});

test("desktop bootstrap and startup pair only daemon, without starting Hub or web", async () => {
  const selectedHome = home();
  await preparePersonalDesktopHome(selectedHome, "/packaged/resources/app-dist");
  const config = readPersistedConfig(selectedHome);
  expect(config.daemon?.managedAccess?.mode).toBe("off");
  expect(config.features?.webUi?.distDir).toBe("/packaged/resources/app-dist");
  cli.mockResolvedValue({ url: "https://app.clisbot.com/#offer=fixture" });
  expect(await personalDesktopPairing(selectedHome)).toContain("#offer=");
  expect(cli.mock.calls[0]?.[0]).toEqual([
    "daemon",
    "pair",
    "--home",
    selectedHome,
    "--label",
    "Desktop app",
    "--json",
  ]);
});

test("explicit Hub startup returns only an approved offer through existing lifecycle command", async () => {
  const selectedHome = home();
  const hub = {
    hubId: "hub-fixture",
    publicKey: "public",
    origin: "http://127.0.0.1:6870",
    pairing: { token: "one-use", expiresAt: 123 },
  };
  cli.mockResolvedValue({
    url: "https://app.clisbot.com/#offer=fixture",
    hubOffer: hub,
    origin: "http://127.0.0.1:6880",
    transport: "local",
  });
  expect(
    await startDesktopHub(selectedHome, { transport: "local", label: "My phone" }),
  ).toMatchObject({ hub, transport: "local" });
  expect(cli.mock.calls[0]?.[0]).toEqual([
    "hub",
    "start",
    "--personal",
    "--home",
    selectedHome,
    "--json",
    "--transport",
    "local",
    "--label",
    "My phone",
  ]);
  cli.mockResolvedValue({ url: "https://app.clisbot.com/#offer=unapproved" });
  await expect(startDesktopHub(selectedHome, {})).rejects.toThrow("approved connection offer");
});
