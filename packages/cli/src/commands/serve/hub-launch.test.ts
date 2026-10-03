import { afterEach, expect, test, vi } from "vitest";
import { prepareHub } from "./hub-launch.js";

const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock("../hub/local-hub.js", () => ({
  resolveLocalHubState: () => ({ running: true, state: { url: "http://127.0.0.1:6870" } }),
  startLocalHubDetached: mocks.start,
  stopLocalHub: mocks.stop,
}));
afterEach(() => vi.unstubAllGlobals());

test("legacy Hub cannot be exposed before protected pairing is enabled", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ devicePairing: false })),
  );
  await expect(prepareHub("/private/home", "https://public.example", true)).rejects.toThrow(
    "before remote serving",
  );
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.stop).not.toHaveBeenCalled();
});

test("protected existing Hub is reused without changing its ownership or account mode", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ devicePairing: true, loginRequired: true })),
  );
  expect(await prepareHub("/private/home", "https://public.example", true)).toBe(
    "http://127.0.0.1:6870",
  );
  expect(mocks.start).not.toHaveBeenCalled();
});
