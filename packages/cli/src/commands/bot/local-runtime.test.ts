import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { selectLocalPort } from "../hub/local-port.js";
import {
  assertLocalOnboardingAccess,
  onboardingDaemonListen,
  recordedDaemonHost,
  verifyOnboardingDaemon,
  waitForOnboardingHub,
} from "./local-runtime.js";

const homes: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function createHome(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "onboarding-runtime-"));
  homes.push(directory);
  return directory;
}

it("rejects managed TCP onboarding before connection while preserving policy and IPC recovery", async () => {
  const directory = await createHome();
  const configPath = path.join(directory, "config.json");
  const config = JSON.stringify({
    daemon: { listen: "127.0.0.1:6767", managedAccess: { mode: "external" } },
  });
  await writeFile(configPath, config);
  expect(() => assertLocalOnboardingAccess(directory, {})).toThrow("select an empty --home");
  expect(() =>
    assertLocalOnboardingAccess(directory, { PASEO_LISTEN: "unix:///tmp/recovery.sock" }),
  ).not.toThrow();
  expect(() => assertLocalOnboardingAccess(directory, {})).toThrow("Hub-managed access");
  expect(await readFile(configPath, "utf8")).toBe(config);
});

it("allows fresh standalone onboarding without a managed ticket", async () => {
  const directory = await createHome();
  expect(() => assertLocalOnboardingAccess(directory, {})).not.toThrow();
});

async function listen(instanceId = "other-home") {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, instanceId }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test port");
  return { port: address.port, url: `http://127.0.0.1:${address.port}` };
}

it("allocates a different port for another home while preserving an explicit port choice", async () => {
  const occupied = await listen();
  expect(await selectLocalPort(occupied.port, true)).not.toBe(occupied.port);
  await expect(selectLocalPort(occupied.port, false)).rejects.toThrow("already in use");
  expect((await fetch(`${occupied.url}/health`)).ok).toBe(true);
});

it("avoids a colliding persisted daemon port, but refuses a colliding explicit environment port", async () => {
  const directory = await createHome();
  const occupied = await listen();
  await writeFile(
    path.join(directory, "config.json"),
    JSON.stringify({ daemon: { listen: `127.0.0.1:${occupied.port}` } }),
  );
  expect(await onboardingDaemonListen(directory, {})).not.toBe(`127.0.0.1:${occupied.port}`);
  await expect(
    onboardingDaemonListen(directory, { PASEO_LISTEN: `127.0.0.1:${occupied.port}` }),
  ).rejects.toThrow("already in use");
});

it("does not treat a live supervisor without a listener as a ready daemon", async () => {
  const directory = await createHome();
  await writeFile(
    path.join(directory, "paseo.pid"),
    JSON.stringify({ pid: process.pid, listen: null }),
  );
  expect(() => recordedDaemonHost(directory)).toThrow("no ready listener");
});

it("closes a connection to another daemon before any onboarding mutation", async () => {
  const directory = await createHome();
  await writeFile(path.join(directory, "server-id"), "this-home\n");
  const close = vi.fn().mockResolvedValue(undefined);
  const client = {
    getLastServerInfoMessage: () => ({ serverId: "other-home" }),
    close,
  } as unknown as DaemonClient;
  await expect(verifyOnboardingDaemon(client, directory)).rejects.toThrow("does not belong");
  expect(close).toHaveBeenCalledOnce();
});

it("rejects a healthy Hub belonging to another launch even while the new child is alive", async () => {
  const directory = await createHome();
  const occupied = await listen();
  await writeFile(
    path.join(directory, "hub-local.json"),
    JSON.stringify({ ...occupied, pid: process.pid, instanceId: "this-home" }),
  );
  await expect(waitForOnboardingHub(occupied.url, directory)).rejects.toThrow("Another Hub");
});

it("rejects a dead child even when another Hub answers health at its recorded URL", async () => {
  const directory = await createHome();
  const occupied = await listen();
  await writeFile(
    path.join(directory, "hub-local.json"),
    JSON.stringify({ ...occupied, pid: 2147483647 }),
  );
  await expect(waitForOnboardingHub(occupied.url, directory)).rejects.toThrow(
    "exited during startup",
  );
});

it("accepts health only from the live recorded launch", async () => {
  const directory = await createHome();
  const own = await listen("this-home");
  await writeFile(
    path.join(directory, "hub-local.json"),
    JSON.stringify({ ...own, pid: process.pid, instanceId: "this-home" }),
  );
  await expect(waitForOnboardingHub(own.url, directory)).resolves.toBeUndefined();
});
