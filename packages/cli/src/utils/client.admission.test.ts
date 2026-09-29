import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDaemon } from "./client.js";

const mocks = vi.hoisted(() => ({
  configs: [] as Array<Record<string, unknown>>,
  connect: vi.fn(),
  readLocalCredential: vi.fn(),
  resolveTicket: vi.fn(),
}));

vi.mock("@clisbot/server/daemon-control", () => ({
  waitForDaemonReady: async () => ({ listen: "unix:///selected/daemon.sock" }),
  resolveClisbotHome: () => "/default/home",
  readLocalCredentialForTarget: mocks.readLocalCredential,
}));
vi.mock("@clisbot/client/internal/daemon-client", () => ({
  DaemonClient: class {
    lastError = null;
    constructor(config: Record<string, unknown>) {
      mocks.configs.push(config);
    }
    connect = mocks.connect;
    async close() {}
  },
}));
vi.mock("./client-id.js", () => ({ getOrCreateCliClientId: async () => "cli-test-id" }));
vi.mock("../commands/hub/daemon-access-ticket.js", () => ({
  requiresDaemonAccessTicket: (error: Error) => error.message === "Managed access ticket required",
  createDaemonAccessTicketResolver: mocks.resolveTicket,
}));

describe("CLI credential and managed admission composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configs.length = 0;
    mocks.connect.mockReset();
    mocks.connect
      .mockRejectedValueOnce(new Error("Managed access ticket required"))
      .mockResolvedValue(undefined);
    mocks.readLocalCredential.mockReturnValue("local-token");
    mocks.resolveTicket.mockReturnValue(async () => "hub-ticket");
  });

  it("retains local credential refresh and selected home when retrying with a Hub ticket", async () => {
    await connectToDaemon({ target: { kind: "instance", home: "/selected/home" } });

    expect(mocks.resolveTicket).toHaveBeenCalledWith({
      clisbotHome: "/selected/home",
      clientId: "cli-test-id",
    });
    expect(mocks.configs).toHaveLength(2);
    const retry = mocks.configs[1]!;
    expect(retry.resolveAccessTicket).toEqual(expect.any(Function));
    mocks.readLocalCredential.mockReturnValue("rotated-token");
    expect((retry.localCredential as () => string)()).toBe("rotated-token");
    expect(mocks.readLocalCredential).toHaveBeenLastCalledWith(
      "/selected/home",
      "unix:///selected/daemon.sock",
    );
  });

  it("retains an explicit password when retrying with managed admission", async () => {
    await connectToDaemon({
      target: { kind: "endpoint", host: "tcp://localhost:6767?password=secret" },
    });
    expect(mocks.configs).toHaveLength(2);
    expect(mocks.configs[1]).toMatchObject({
      password: "secret",
      resolveAccessTicket: expect.any(Function),
    });
    expect(mocks.configs[1]).not.toHaveProperty("localCredential");
  });
});
