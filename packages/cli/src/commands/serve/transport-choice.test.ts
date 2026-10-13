import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  readTransportChoice,
  saveTransportChoice,
  tailscaleSetupError,
} from "./transport-choice.js";
import { renderError, toCommandError } from "../../output/render.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

test("remembers explicit routes without interpreting legacy relay-enabled as consent", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "clisbot-route-choice-"));
  homes.push(home);
  await writeFile(
    path.join(home, "config.json"),
    JSON.stringify({ daemon: { relay: { enabled: true } } }),
  );
  expect(readTransportChoice(home)).toBeUndefined();
  for (const choice of ["relay", "tailscale", "local"]) {
    saveTransportChoice(home, choice);
    expect(readTransportChoice(home)).toBe(choice);
  }
  expect(JSON.parse(await readFile(path.join(home, "config.json"), "utf8"))).toEqual({
    daemon: { relay: { enabled: true } },
  });
});

test("Tailscale failures give one readable message and structured recovery for the same home", () => {
  const home = "/tmp/owner's home $(nope)";
  const error = tailscaleSetupError(home, new Error("Serve denied"));
  const rendered = renderError(toCommandError(error), { noColor: true });
  expect(rendered.match(/Error:/g)).toHaveLength(1);
  expect(rendered).not.toContain(" at ");
  expect(rendered).toContain("no automatic switch to relay");
  expect(rendered).toContain("end-to-end encryption");
  const json = JSON.parse(renderError(toCommandError(error), { format: "json" }));
  expect(json.error.code).toBe("TAILSCALE_SETUP_REQUIRED");
  expect(json.error.details.reason).toBe("Serve denied");
  expect(json.error.details.relayCommand).toContain("clisbot onboard --home");
  expect(json.error.details.relayCommand).toContain("--relay");
  expect(json.error.details.retryCommand).toContain("--transport tailscale");
});

test("Hub failure recovery starts a Hub, not just a Host", () => {
  const json = toCommandError(tailscaleSetupError("/tmp/hub", new Error("Serve denied"), true));
  expect(json.message).toContain("clisbot hub start --personal --home");
  expect(json.message).toContain("--transport relay");
});
