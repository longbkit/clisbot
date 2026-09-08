import { expect, it, vi } from "vitest";
import type { APIInteraction } from "discord-api-types/v10";
import type { Client } from "../internal/client.js";
import { normalizeDiscordPaseoCommand, PaseoInteractionListener, registerDiscordPaseoCommand } from "./commands.js";
const app = "111111111111111111";
function interaction(command = "status"): APIInteraction {
  return { id: "123", application_id: app, type: 2, token: "private-token", channel_id: "456", guild_id: "789",
    member: { user: { id: "user", username: "alice" } },
    data: { name: "paseo", type: 1, options: [{ name: "command", type: 3, value: command }] },
  } as APIInteraction;
}
it("normalizes umbrella commands and approvals into the same plaintext vocabulary", () => {
  for (const command of ["model list", "approve request-1", "deny request-1", "skill status"]) {
    const event = normalizeDiscordPaseoCommand(interaction(command), app);
    expect(event?.body).toBe(`/${command}`); expect(event?.wasMentioned).toBe(true);
    expect(JSON.stringify(event)).not.toContain("private-token");
  }
  expect(normalizeDiscordPaseoCommand(interaction(""), app)?.body).toBe("/help");
  expect(normalizeDiscordPaseoCommand(interaction(), "other-app")).toBeUndefined();
});
it("registers one umbrella without replacing other application commands", async () => {
  const post = vi.fn(async () => undefined);
  await registerDiscordPaseoCommand({ options: { clientId: app }, rest: { post } } as unknown as Client);
  expect(post).toHaveBeenCalledWith(`/applications/${app}/commands`, { body: expect.objectContaining({ name: "paseo", options: [expect.objectContaining({ name: "command", type: 3 })] }) });
});
it("durably admits before acknowledgement and does not persist the interaction token", async () => {
  const order: string[] = [];
  const listener = new PaseoInteractionListener(app, async (event) => { expect(event.body).toBe("/status"); order.push("admitted"); });
  const client = { rest: { post: async () => { order.push("acknowledged"); } } } as unknown as Client;
  await listener.handle(interaction(), client);
  expect(order).toEqual(["admitted", "acknowledged"]);
});
it("reports admission failure to the invoking user", async () => {
  const listener = new PaseoInteractionListener(app, async () => { throw new Error("queue unavailable"); });
  const post = vi.fn(async () => undefined);
  await expect(listener.handle(interaction(), { rest: { post } } as unknown as Client)).rejects.toThrow("queue unavailable");
  expect(post).toHaveBeenCalledWith(expect.any(String), { body: { type: 4, data: { content: expect.stringContaining("could not be accepted"), flags: 64 } } });
});
