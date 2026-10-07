import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const cli = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../local-cli.js", () => ({ runLocalCliJson: cli.run }));
vi.mock("./tailscale.js", () => ({
  runTailscale: vi.fn(),
  detectTailscale: async () => ({ state: "ready", dnsName: "mac.tail1.ts.net" }),
  readTailscaleServeHandler: async () => undefined,
}));
const { setUpHostTailscale } = await import("./host-tailscale.js");

let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "clisbot-host-tailscale-setup-"));
  cli.run.mockReset();
});
afterEach(() => rm(home, { recursive: true, force: true }));

test("reports Serve failure with Tailscale's approval link instead of a ready state", async () => {
  cli.run.mockResolvedValue({
    tailscaleState: "unavailable",
    networkGuidance: "Enable Serve on your tailnet, then retry.",
    tailscaleActionUrl: "https://login.tailscale.com/f/serve?node=n1",
  });
  expect(await setUpHostTailscale(home)).toEqual({
    state: "unavailable",
    dnsName: "mac.tail1.ts.net",
    guidance: "Enable Serve on your tailnet, then retry.",
    actionUrl: "https://login.tailscale.com/f/serve?node=n1",
  });
  expect(cli.run.mock.calls[0]![0].args).toEqual([
    "daemon",
    "pair",
    "--home",
    home,
    "--transport",
    "tailscale",
    "--json",
  ]);
});

test("runs one setup at a time per Host", async () => {
  let finish: (value: unknown) => void = () => undefined;
  cli.run.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const first = setUpHostTailscale(home);
  await vi.waitFor(() => expect(cli.run).toHaveBeenCalledTimes(1));
  await expect(setUpHostTailscale(home)).rejects.toThrow("already being set up");
  finish({ tailscaleState: "unavailable" });
  await expect(first).resolves.toMatchObject({ state: "unavailable" });
});
