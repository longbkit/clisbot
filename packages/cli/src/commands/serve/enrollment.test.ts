import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { enrollPersonalDaemon } from "./enrollment.js";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  token: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("../../utils/client.js", () => ({
  connectToDaemon: async () => ({
    getHubStatus: mocks.status,
    connectHub: mocks.connect,
    close: mocks.close,
  }),
}));
vi.mock("../hub/device-pairing.js", () => ({ localHubDeviceRequest: mocks.token }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.status.mockReset().mockResolvedValue({ status: { hubOrigin: null } });
  mocks.token.mockResolvedValue({ token: "operator-enrollment" });
});
afterEach(() => vi.unstubAllGlobals());

test("mandatory login leaves machine enrollment for an account-approved flow without blocking pairing", async () => {
  mocks.fetch.mockResolvedValue(Response.json({ loginRequired: true }));
  expect(await enrollPersonalDaemon("/private/home", "http://127.0.0.1:6870")).toBe(
    "account-approval-required",
  );
  expect(mocks.token).not.toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
});

test("personal composition enrolls with an OS-approved machine token", async () => {
  mocks.fetch.mockResolvedValue(Response.json({ loginRequired: false }));
  mocks.status
    .mockResolvedValueOnce({ status: { hubOrigin: null } })
    .mockResolvedValueOnce({ status: { state: "connected" } });
  expect(await enrollPersonalDaemon("/private/home", "http://127.0.0.1:6870")).toBe("connected");
  expect(mocks.connect).toHaveBeenCalledWith(
    "http://127.0.0.1:6870",
    "operator-enrollment",
    expect.any(Array),
  );
});

test("unknown policy fails closed and enrollment never switches an existing Hub", async () => {
  mocks.fetch.mockResolvedValue(Response.json({}));
  await expect(enrollPersonalDaemon("/private/home", "http://127.0.0.1:6870")).rejects.toThrow(
    "login policy",
  );
  mocks.status.mockResolvedValue({ status: { hubOrigin: "https://other.example" } });
  await expect(enrollPersonalDaemon("/private/home", "http://127.0.0.1:6870")).rejects.toThrow(
    "Disconnect",
  );
  expect(mocks.token).not.toHaveBeenCalled();
});
