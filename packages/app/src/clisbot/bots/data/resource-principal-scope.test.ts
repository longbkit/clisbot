// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  hub: {
    enabled: false,
    origin: "hub",
    signedIn: undefined as undefined | { account: { id: string }; organization: { id: string } },
  },
}));
vi.mock("@/clisbot/hub/account-provider", () => ({ useHubAccount: () => state.hub }));
import { useResourcePrincipalScope } from "./resource-principal-scope";
import { conversationLayoutKey } from "../chat/conversation-layout";
it("keeps layout identity through remount/reconnect but separates accounts and organizations", () => {
  state.hub.signedIn = { account: { id: "alice" }, organization: { id: "org-a" } };
  const first = renderHook(useResourcePrincipalScope);
  const key = conversationLayoutKey("host", "chat", first.result.current);
  first.unmount();
  const next = renderHook(useResourcePrincipalScope);
  expect(conversationLayoutKey("host", "chat", next.result.current)).toBe(key);
  state.hub.signedIn = { account: { id: "bob" }, organization: { id: "org-a" } };
  next.rerender();
  expect(conversationLayoutKey("host", "chat", next.result.current)).not.toBe(key);
  state.hub.signedIn = { account: { id: "alice" }, organization: { id: "org-b" } };
  next.rerender();
  expect(conversationLayoutKey("host", "chat", next.result.current)).not.toBe(key);
});
