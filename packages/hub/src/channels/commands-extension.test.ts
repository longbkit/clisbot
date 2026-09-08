import { expect, it } from "vitest";
import {
  runExtensionCommand,
  expandDynamicCommand,
  type DynamicCommandStore,
  type ExtensionCommandInput,
} from "./commands-extension.js";
function fixture(): ExtensionCommandInput {
  const commands = new Map<string, { name: string; prompt: string }>();
  const store: DynamicCommandStore = {
    listCommands: async (key) =>
      [...commands]
        .filter(([id]) => id.startsWith(`${key.accountId}/`))
        .map(([, command]) => command),
    findCommand: async (key, name) => commands.get(`${key.accountId}/${name}`),
    setCommand: async (key, command) => {
      commands.set(`${key.accountId}/${command.name}`, command);
    },
    removeCommand: async (key, name) => commands.delete(`${key.accountId}/${name}`),
  };
  return {
    command: { name: "command" },
    store,
    key: { organizationId: "org", channel: "slack", accountId: "one" },
    senderIdentity: "slack:user",
    canManageCommands: true,
    daemon: {
      listCommands: async () => [
        { name: "status", description: "Agent status skill", argumentHint: "", kind: "skill" },
        { name: "review", description: "Review change", argumentHint: "", kind: "command" },
      ],
    },
    agentId: "bound",
  };
}
it("roundtrips commands and isolates accounts", async () => {
  const input = fixture();
  input.command.value = "add summary Summarize the repository";
  expect((await runExtensionCommand(input)).text).toContain("Saved /summary");
  expect(await expandDynamicCommand(input.store, input.key, "/summary include tests")).toBe(
    "Summarize the repository\n\ninclude tests",
  );
  expect(
    await expandDynamicCommand(input.store, { ...input.key, accountId: "two" }, "/summary"),
  ).toBeUndefined();
  input.command.value = "search summary";
  expect((await runExtensionCommand(input)).text).toContain("summary");
  input.command.value = "remove summary";
  expect((await runExtensionCommand(input)).text).toContain("Removed");
  expect(await expandDynamicCommand(input.store, input.key, "/summary")).toBeUndefined();
});
it("refuses reserved aliases and requires approval.config", async () => {
  const input = fixture();
  for (const name of ["status", "state", "approve", "deny", "paseo"]) {
    input.command.value = `add ${name} prompt`;
    expect((await runExtensionCommand(input)).text).toContain("reserved");
  }
  input.command.value = "add custom prompt";
  input.canManageCommands = false;
  expect((await runExtensionCommand(input)).text).toContain("approval.config");
  expect(await input.store.listCommands(input.key)).toEqual([]);
});
it("explicit skill dispatch survives collision with platform names", async () => {
  const input = fixture();
  input.command = { name: "skill", value: "status" };
  expect(await runExtensionCommand(input)).toEqual({ prompt: "/status" });
  input.command.value = "list";
  expect((await runExtensionCommand(input)).text).toContain("status");
  expect((await runExtensionCommand(input)).text).not.toContain("review");
});
it("preserves unknown fallthrough and native command arguments", async () => {
  const input = fixture();
  expect(await expandDynamicCommand(input.store, input.key, "explain /review")).toBeUndefined();
  expect(await expandDynamicCommand(input.store, input.key, "/unknown args")).toBeUndefined();
  input.command.value = "review HEAD";
  expect((await runExtensionCommand(input)).prompt).toBe("/review HEAD");
});

it("expands an account command through the same mention and umbrella normalization", async () => {
  const store = {
    findCommand: async () => ({ name: "review-code", prompt: "Review carefully" }),
  } as Pick<DynamicCommandStore, "findCommand">;
  for (const text of [
    "@bot /review-code",
    "/review-code@bot",
    "/paseo review-code",
    "<@123456789> /review-code",
  ]) {
    expect(
      await expandDynamicCommand(
        store,
        { organizationId: "org", channel: "slack", accountId: "work" },
        text,
      ),
    ).toBe("Review carefully");
  }
});
