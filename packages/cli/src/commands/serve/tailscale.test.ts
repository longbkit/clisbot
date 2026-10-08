import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  configureTailscaleServe,
  removeTailscaleServe,
  readTailscaleServePort,
  selectTailscaleServePort,
} from "./tailscale.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

test("owns only its Serve path and refuses foreign or replaced mappings", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "clisbot-serve-"));
  homes.push(home);
  const authority = "host.tail123.ts.net:8443";
  let proxy: string | undefined = "http://127.0.0.1:9999";
  const run = vi.fn(async (args: string[]) =>
    args[1] === "status"
      ? JSON.stringify({
          Web: {
            [authority]: { Handlers: proxy ? { "/": { Proxy: proxy } } : {} },
            "other.tail123.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8888" } } },
          },
        })
      : "",
  );
  const options = {
    home,
    dnsName: "host.tail123.ts.net",
    port: 8443,
    target: "http://127.0.0.1:6880",
  };
  await expect(configureTailscaleServe(options, run)).rejects.toThrow("preserved");
  expect(run).toHaveBeenCalledTimes(1);
  proxy = undefined;
  expect(await configureTailscaleServe(options, run)).toBe(`https://${authority}`);
  proxy = options.target;
  await configureTailscaleServe(options, run);
  expect(JSON.parse(await readFile(path.join(home, "tailscale-serve.json"), "utf8"))).toEqual({
    authority,
    target: options.target,
  });
  const updated = { ...options, target: "http://127.0.0.1:6881" };
  await configureTailscaleServe(updated, run);
  expect(run).toHaveBeenLastCalledWith([
    "serve",
    "--bg",
    "--https=8443",
    "--set-path=/",
    updated.target,
  ]);
  proxy = "http://127.0.0.1:5555";
  await expect(removeTailscaleServe(home, run)).rejects.toThrow("preserved");
  proxy = updated.target;
  await removeTailscaleServe(home, run);
  expect(run).toHaveBeenLastCalledWith(["serve", "--https=8443", "--set-path=/", "off"]);
  const calls = run.mock.calls.length;
  await removeTailscaleServe(home, run);
  expect(run).toHaveBeenCalledTimes(calls);
  expect(run.mock.calls.flat(2)).not.toContain("reset");
});

test("normalizes HTTPS default port to the browser Origin while recording the owned Serve authority", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "clisbot-tailscale-origin-"));
  homes.push(home);
  const run = vi.fn(async (args: string[]) => (args[1] === "status" ? "{}" : ""));
  expect(
    await configureTailscaleServe(
      { home, dnsName: "host.tail123.ts.net", port: 443, target: "http://127.0.0.1:6880" },
      run,
    ),
  ).toBe("https://host.tail123.ts.net");
  expect(
    JSON.parse(await readFile(path.join(home, "tailscale-serve.json"), "utf8")).authority,
  ).toBe("host.tail123.ts.net:443");
  expect(readTailscaleServePort(home, "host.tail123.ts.net")).toBe(443);
});

test("reuses a custom HTTPS port without taking ownership of a replaced mapping", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "clisbot-tailscale-reuse-"));
  homes.push(home);
  const dnsName = "host.tail123.ts.net";
  const authority = `${dnsName}:8452`;
  let proxy: string | undefined;
  const run = vi.fn(async (args: string[]) =>
    args[1] === "status"
      ? JSON.stringify({
          Web: { [authority]: { Handlers: proxy ? { "/": { Proxy: proxy } } : {} } },
        })
      : "",
  );
  expect(readTailscaleServePort(home, dnsName)).toBeUndefined();
  const options = { home, dnsName, port: 8452, target: "http://127.0.0.1:6889" };
  await configureTailscaleServe(options, run);
  expect(readTailscaleServePort(home, dnsName)).toBe(8452);
  proxy = options.target;
  await configureTailscaleServe({ ...options, port: readTailscaleServePort(home, dnsName)! }, run);
  expect(run).toHaveBeenLastCalledWith([
    "serve",
    "--bg",
    "--https=8452",
    "--set-path=/",
    options.target,
  ]);
  proxy = "http://127.0.0.1:9999";
  run.mockClear();
  await expect(
    configureTailscaleServe({ ...options, port: readTailscaleServePort(home, dnsName)! }, run),
  ).rejects.toThrow("preserved");
  expect(run).toHaveBeenCalledTimes(1);
});

test("ignores saved ports for another Tailscale host and invalid records", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "clisbot-tailscale-port-"));
  homes.push(home);
  for (const authority of [
    "other.tail123.ts.net:8452",
    "host.tail123.ts.net:0",
    "host.tail123.ts.net:65536",
    "host.tail123.ts.net:8452/path",
    "user@host.tail123.ts.net:8452",
    "host.tail123.ts.net:8452?query",
    "host.tail123.ts.net:8452#fragment",
  ]) {
    await writeFile(path.join(home, "tailscale-serve.json"), JSON.stringify({ authority }));
    expect(readTailscaleServePort(home, "host.tail123.ts.net")).toBeUndefined();
  }
  await writeFile(path.join(home, "tailscale-serve.json"), "invalid JSON");
  expect(readTailscaleServePort(home, "host.tail123.ts.net")).toBeUndefined();
});

test("adopts a mapping that already reaches this home's gateway", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "clisbot-tailscale-adopt-"));
  homes.push(home);
  const dnsName = "host.tail123.ts.net";
  const target = "http://127.0.0.1:6880";
  const run = vi.fn(async (args: string[]) =>
    args[1] === "status"
      ? JSON.stringify({
          Web: { [`${dnsName}:8443`]: { Handlers: { "/": { Proxy: target } } } },
        })
      : "",
  );
  expect(await configureTailscaleServe({ home, dnsName, port: 8443, target }, run)).toBe(
    `https://${dnsName}:8443`,
  );
  expect(readTailscaleServePort(home, dnsName)).toBe(8443);
});

test("selects the next free HTTPS port unless the person chose one", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "clisbot-tailscale-select-"));
  homes.push(home);
  const dnsName = "host.tail123.ts.net";
  const target = "http://127.0.0.1:6880";
  const run = vi.fn(async () =>
    JSON.stringify({
      TCP: { "8444": { TCPForward: "127.0.0.1:9230" } },
      Web: {
        [`${dnsName}:8443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } } },
        [`${dnsName}:8445`]: { Handlers: { "/": { Proxy: target } } },
      },
    }),
  );
  const select = (fixed: boolean, preferred = 8443) =>
    selectTailscaleServePort({ home, dnsName, preferred, fixed, target }, run);

  expect(await select(false)).toBe(8445);
  expect(await select(false, 8446)).toBe(8446);
  await expect(select(true)).rejects.toThrow("Choose another --https-port");
});
