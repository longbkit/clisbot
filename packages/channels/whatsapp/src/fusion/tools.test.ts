import { beforeEach, describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({ sendMessage: vi.fn(async () => ({ key: { id: "LOC1" } })) }));
vi.mock("../connection-controller-runtime-context.js", () => ({
  getWhatsAppConnectionController: (accountId: string) =>
    accountId === "acc" ? { getCurrentSock: () => ({ sendMessage: live.sendMessage }) } : null,
}));

const { createWhatsAppLocationTool, collectWhatsAppToolRegistrations } = await import("./tools.js");

const ctx = (to?: string, accountId = "acc") => ({
  deliveryContext: { channel: "whatsapp", accountId, ...(to ? { to } : {}) },
});

describe("whatsapp_send_location", () => {
  beforeEach(() => live.sendMessage.mockClear());

  it("posts a native pin into the conversation being answered, nowhere else", async () => {
    const tool = createWhatsAppLocationTool(ctx("120363000000000004@g.us"));
    expect(tool?.name).toBe("whatsapp_send_location");
    expect(Object.keys((tool!.parameters as { properties: object }).properties)).not.toContain("to");
    const result = await tool!.execute!("call1", { latitude: 10.7769, longitude: 106.7009, name: "Ben Thanh", to: "attacker@s.whatsapp.net" });
    expect(live.sendMessage).toHaveBeenCalledWith("120363000000000004@g.us", {
      location: { degreesLatitude: 10.7769, degreesLongitude: 106.7009, name: "Ben Thanh" },
    });
    expect(result.details).toMatchObject({ ok: true, messageId: "LOC1" });
  });

  it("refuses out-of-range coordinates and an account that is not connected", async () => {
    const tool = createWhatsAppLocationTool(ctx("x@s.whatsapp.net"));
    await expect(tool!.execute!("c", { latitude: 91, longitude: 0 })).rejects.toThrow(/latitude/);
    const offline = createWhatsAppLocationTool(ctx("x@s.whatsapp.net", "other"));
    await expect(offline!.execute!("c", { latitude: 1, longitude: 2 })).rejects.toThrow(/not connected/);
  });

  it("offers no tool without a bound conversation", () => {
    expect(createWhatsAppLocationTool(ctx())).toBeNull();
    expect(collectWhatsAppToolRegistrations()).toHaveLength(1);
  });
});
