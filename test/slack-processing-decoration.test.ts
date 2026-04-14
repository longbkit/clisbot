import { describe, expect, test } from "bun:test";
import { activateSlackProcessingDecoration } from "../src/channels/slack/processing-decoration.ts";

describe("activateSlackProcessingDecoration", () => {
  test("cleans up only the side effects that were actually applied", async () => {
    const events: string[] = [];
    const cleanup = await activateSlackProcessingDecoration({
      addReaction: async () => {
        events.push("add-reaction");
        return true;
      },
      removeReaction: async () => {
        events.push("remove-reaction");
        return true;
      },
      setStatus: async () => {
        events.push("set-status");
        return false;
      },
      clearStatus: async () => {
        events.push("clear-status");
        return true;
      },
    });

    await cleanup();

    expect(events).toEqual([
      "add-reaction",
      "set-status",
      "remove-reaction",
    ]);
  });

  test("keeps cleanup for successful work even when a sibling activation step throws", async () => {
    const events: string[] = [];
    const failures: string[] = [];
    const cleanup = await activateSlackProcessingDecoration({
      addReaction: async () => {
        events.push("add-reaction");
        return true;
      },
      removeReaction: async () => {
        events.push("remove-reaction");
        return true;
      },
      setStatus: async () => {
        events.push("set-status");
        throw new Error("boom");
      },
      clearStatus: async () => {
        events.push("clear-status");
        return true;
      },
      onUnexpectedError: (phase, error) => {
        failures.push(`${phase}:${error instanceof Error ? error.message : String(error)}`);
      },
    });

    await cleanup();

    expect(events).toEqual([
      "add-reaction",
      "set-status",
      "remove-reaction",
    ]);
    expect(failures).toEqual(["set-status:boom"]);
  });

  test("throws when nothing was applied and an activation step throws unexpectedly", async () => {
    await expect(
      activateSlackProcessingDecoration({
        addReaction: async () => false,
        removeReaction: async () => true,
        setStatus: async () => {
          throw new Error("boom");
        },
        clearStatus: async () => true,
      }),
    ).rejects.toThrow("boom");
  });
});
