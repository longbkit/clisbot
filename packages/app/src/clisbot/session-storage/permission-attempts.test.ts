import { describe, expect, it, vi } from "vitest";
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async (_algorithm: string, text: string) => text,
}));
import { PermissionResponseAttempts } from "./permission-attempts";

const input = {
  serverId: "host",
  agentId: "agent",
  generation: "generation-1",
  response: { behavior: "allow" as const },
};
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
describe("durable permission response attempts", () => {
  it("reuses the same decision UUID after restart and concurrent retries", async () => {
    const saved = storage();
    let ids = 0;
    const create = () =>
      new PermissionResponseAttempts(
        saved,
        async (text) => text,
        () => `id-${++ids}`,
      );
    const first = create();
    const [left, right] = await Promise.all([first.admit(input), first.admit(input)]);
    expect(right).toEqual(left);
    expect(await create().admit(input)).toEqual(left);
    expect(ids).toBe(1);
  });
  it("separates hosts, request generations, and changed decisions", async () => {
    let ids = 0;
    const attempts = new PermissionResponseAttempts(
      storage(),
      async (text) => text,
      () => `id-${++ids}`,
    );
    const records = await Promise.all([
      attempts.admit(input),
      attempts.admit({ ...input, serverId: "other" }),
      attempts.admit({ ...input, generation: "generation-2" }),
      attempts.admit({ ...input, response: { behavior: "deny" } }),
    ]);
    expect(new Set(records.map((record) => record.responseId)).size).toBe(4);
  });
  it("fails admission before returning an ID when persistence fails", async () => {
    const attempts = new PermissionResponseAttempts(
      {
        getItem: async () => null,
        setItem: async () => {
          throw new Error("disk full");
        },
      },
      async (text) => text,
      () => "id",
    );
    await expect(attempts.admit(input)).rejects.toThrow("disk full");
  });
});
