import { it, expect, vi, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
const mocks = vi.hoisted(() => ({
  protected: true,
  running: false,
  launch: vi.fn(),
  gateway: vi.fn(),
  network: vi.fn(async () => ({ state: "ready", dnsName: "fixture.ts.net" })),
  map: vi.fn(async () => "https://fixture.ts.net:8445"),
  admission: vi.fn(),
}));
vi.mock("@clisbot/server/daemon-control", async (original) => ({
  ...(await original<object>()),
  readDaemonInstance: async () => (mocks.running ? { listen: "127.0.0.1:17881", pid: 123 } : null),
}));
vi.mock("@clisbot/server/configuration", async (original) => {
  const actual = await original<typeof import("@clisbot/server/configuration")>();
  return {
    ...actual,
    loadConfig: (selectedHome: string, options: Parameters<typeof actual.loadConfig>[1]) => ({
      ...actual.loadConfig(selectedHome, options),
      webUi: { distDir: path.join(selectedHome, "bundle") },
    }),
  };
});
vi.mock("../daemon/local-daemon.js", () => ({ launchLocalDaemon: mocks.launch }));
vi.mock("../../utils/client.js", () => ({
  connectToDaemon: async () => ({
    getLastServerInfoMessage: () => ({ features: { devicePairing: mocks.protected } }),
    close: async () => {},
  }),
}));
vi.mock("./gateway-launch.js", () => ({ launchGateway: mocks.gateway, stopGateway: vi.fn() }));
vi.mock("./network-admission.js", () => ({ configureServingAdmission: mocks.admission }));
vi.mock("@clisbot/server/gateway-adapters", () => ({
  detectTailscale: mocks.network,
  readTailscaleServeHandler: vi.fn(),
}));
vi.mock("./tailscale.js", () => ({
  selectTailscaleServePort: async () => 8445,
  configureTailscaleServe: mocks.map,
  removeTailscaleServe: vi.fn(),
}));
import { startLocalWeb, localWebStatus } from "./web.js";
const homes: string[] = [];
afterEach(async () => {
  mocks.protected = true;
  mocks.running = false;
  vi.clearAllMocks();
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
async function createWebTestHome() {
  const root = await mkdtemp(path.join(tmpdir(), "web-first-"));
  homes.push(root);
  const directory = path.join(root, "bundle");
  await mkdir(directory);
  await writeFile(path.join(directory, "index.html"), "test");

  mocks.gateway.mockResolvedValue({ origin: "http://127.0.0.1:17882", pid: 123 });
  mocks.launch.mockImplementation(async ({ home: selectedHome }) => ({
    instance: { listen: "127.0.0.1:17881" },
    home: selectedHome,
  }));
  return root;
}
it("prepares protected personal defaults before the first web daemon and any gateway/mapping", async () => {
  const root = await createWebTestHome();
  mocks.launch.mockImplementation(async () => {
    expect(JSON.parse(await readFile(path.join(root, "config.json"), "utf8"))).toMatchObject({
      features: { devicePairing: true, personalServing: true },
      daemon: { managedAccess: { mode: "off" }, relay: { enabled: false } },
    });
    expect(mocks.gateway).not.toHaveBeenCalled();
    expect(mocks.network).not.toHaveBeenCalled();
    return { instance: { listen: "127.0.0.1:17881" } };
  });
  const result = await startLocalWeb(root);
  expect(result).toMatchObject({
    access: "owner-pairing",
    tailscaleUrl: "https://fixture.ts.net:8445",
  });
});
for (const password of [undefined, "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW"])
  it(`refuses legacy exposure without changing existing policy (${password ? "password-only" : "unprotected"})`, async () => {
    const root = await createWebTestHome();
    const original = JSON.stringify({
      version: 1,
      daemon: { managedAccess: { mode: "external" }, ...(password ? { auth: { password } } : {}) },
    });
    await writeFile(path.join(root, "config.json"), original);
    mocks.protected = false;
    await expect(startLocalWeb(root)).rejects.toThrow(/not exposed.*planned Host maintenance/);
    expect(await readFile(path.join(root, "config.json"), "utf8")).toBe(original);
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(mocks.gateway).not.toHaveBeenCalled();
    expect(mocks.network).not.toHaveBeenCalled();
    expect(mocks.map).not.toHaveBeenCalled();
    expect(mocks.admission).not.toHaveBeenCalled();
  });
it("preserves an enrolled managed policy and reports Hub access instead of an Owner shortcut", async () => {
  const root = await createWebTestHome();
  await writeFile(
    path.join(root, "config.json"),
    JSON.stringify({
      features: { devicePairing: true },
      daemon: { managedAccess: { mode: "external" } },
    }),
  );
  await writeFile(path.join(root, "hub-relationship.json"), JSON.stringify({ state: "active" }));
  expect(await startLocalWeb(root)).toMatchObject({ access: "hub-ticket" });
  expect(
    JSON.parse(await readFile(path.join(root, "config.json"), "utf8")).daemon.managedAccess.mode,
  ).toBe("external");
});

it("checks a running legacy Host's effective capability without reconfiguring it or exposing a gateway", async () => {
  const root = await createWebTestHome();
  const original = JSON.stringify({
    features: { devicePairing: true },
    daemon: { managedAccess: { mode: "external" } },
  });
  await writeFile(path.join(root, "config.json"), original);
  mocks.running = true;
  mocks.protected = false;
  await expect(startLocalWeb(root)).rejects.toThrow(/not exposed/);
  expect(await readFile(path.join(root, "config.json"), "utf8")).toBe(original);
  expect(mocks.gateway).not.toHaveBeenCalled();
  expect(mocks.network).not.toHaveBeenCalled();
  expect(mocks.map).not.toHaveBeenCalled();
});

it("status on an empty home is read-only and does not poison later fresh provisioning", async () => {
  const root = await createWebTestHome();
  expect(await localWebStatus(root)).toMatchObject({
    running: false,
    origin: null,
    tailscaleUrl: null,
  });
  await expect(readFile(path.join(root, "config.json"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(mocks.launch).not.toHaveBeenCalled();
  expect(mocks.network).not.toHaveBeenCalled();
});
