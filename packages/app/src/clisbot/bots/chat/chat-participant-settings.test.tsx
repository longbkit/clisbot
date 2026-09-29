// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import type { BotPayload } from "../data/contracts";
import { ChatParticipantSettings } from "./chat-participant-settings";

interface FieldProps {
  members: { id: string }[];
  available: { id: string }[];
  onAdd: (id: string) => void;
}
const field: { current: FieldProps | null } = { current: null };
vi.mock("./bot-members-field", () => ({
  BotMembersField: (props: FieldProps) => {
    field.current = props;
    return null;
  },
}));

const bot = (id: string) => ({ id, name: id }) as BotPayload;
const chat = (ids: string[]) =>
  ({
    id: "c1",
    participants: ids.map((botId) => ({ botId, displayName: botId })),
  }) as unknown as ChatPayload;

describe("ChatParticipantSettings", () => {
  it("queues picks made while a change runs and shows them at once", async () => {
    const resolvers: (() => void)[] = [];
    const toggle = vi.fn(() => new Promise<void>((resolve) => resolvers.push(resolve)));
    render(
      <ChatParticipantSettings
        chat={chat(["a"])}
        bots={[bot("a"), bot("b"), bot("c")]}
        toggle={toggle}
      />,
    );
    act(() => field.current!.onAdd("b"));
    act(() => field.current!.onAdd("c"));
    expect(field.current!.members.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(field.current!.available).toEqual([]);
    expect(toggle.mock.calls).toEqual([["b"]]);
    await act(async () => resolvers.shift()!());
    expect(toggle.mock.calls).toEqual([["b"], ["c"]]);
  });
});
