import { describe, expect, test } from "vitest";
import {
  CLIENT_SLASH_COMMANDS,
  CONVERSATION_SLASH_COMMANDS,
  clientSlashCommandsFor,
  resolveClientSlashCommand,
} from "./index";

describe("client slash commands", () => {
  test("a Chat composer gets the Chat's commands and an agent tab its own", () => {
    expect(clientSlashCommandsFor("conversation")).toBe(CONVERSATION_SLASH_COMMANDS);
    expect(clientSlashCommandsFor("agent")).toBe(CLIENT_SLASH_COMMANDS);
    expect(clientSlashCommandsFor(undefined)).toBe(CLIENT_SLASH_COMMANDS);
  });

  test("/new with trailing spaces is the Chat's fresh session; arguments make it plain text", () => {
    const resolve = (text: string, hasAttachments = false) =>
      resolveClientSlashCommand({ text, hasAttachments, commands: CONVERSATION_SLASH_COMMANDS })
        ?.kind ?? null;
    expect(resolve("/new")).toBe("fresh-chat-session");
    expect(resolve("/new   ")).toBe("fresh-chat-session");
    expect(resolve("  /new\n")).toBe("fresh-chat-session");
    expect(resolve("/new later")).toBeNull();
    expect(resolve("/new", true)).toBeNull();
    expect(resolve("/clear")).toBeNull();
    expect(resolve("/exit")).toBeNull();
  });

  test("an agent tab keeps /new as its /clear alias", () => {
    expect(resolveClientSlashCommand({ text: "/new", hasAttachments: false })?.name).toBe("clear");
  });
});
