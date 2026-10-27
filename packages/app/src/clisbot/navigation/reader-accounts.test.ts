import { describe, expect, it } from "vitest";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import { forgetReader, rememberReader, type RememberedReader } from "@/clisbot/hub/reader-memory";
import { resolveOwnership } from "./ownership";
import { useReaderMemory } from "@/clisbot/hub/reader-memory";
import { mergeReaderAccounts, readerAccountOf, recordVerifiedReaders } from "./reader-accounts";

const signedIn = (id: string, memberId: string) =>
  ({ account: { id }, membership: { id: memberId } }) as never;
const actor = (id: string, hubOrigin: string, extra: Partial<SessionActor> = {}): SessionActor => ({
  kind: "user",
  id,
  hubOrigin,
  ...extra,
});

describe("readerAccountOf", () => {
  it("names a signed-in Hub account by every address and identity it is known by", () => {
    expect(
      readerAccountOf({
        origin: "https://hub.example",
        connectionOrigin: "https://hub.example",
        signedIn: signedIn("u-me", "m-me"),
      }),
    ).toEqual({
      origin: "https://hub.example",
      aliases: ["https://hub.example"],
      id: "u-me",
      memberId: "m-me",
    });
    expect(
      readerAccountOf({
        origin: "hub://hub-1",
        connectionOrigin: "https://work.example",
        signedIn: signedIn("u-me", "m-me"),
      }),
    ).toEqual({
      origin: "hub://hub-1",
      aliases: ["https://work.example"],
      hubId: "hub-1",
      id: "u-me",
      memberId: "m-me",
    });
  });

  it("is nothing while the account is not signed in", () => {
    expect(
      readerAccountOf({ origin: "https://hub.example", connectionOrigin: null, signedIn: null }),
    ).toBeUndefined();
  });
});

describe("last verified reader", () => {
  const verified: RememberedReader = {
    origin: "https://hub.example",
    aliases: [],
    id: "u-me",
    memberId: "m-me",
  };
  const mine = actor("u-me", "https://hub.example");
  const theirs = actor("u-2", "https://hub.example");

  it("keeps classifying while the Hub cannot confirm the account", () => {
    const remembered = rememberReader({}, verified);
    // Offline, loading or signed out: no live account.
    const accounts = mergeReaderAccounts([], Object.values(remembered));
    expect(resolveOwnership({ createdBy: mine, accounts })).toBe("mine");
    expect(resolveOwnership({ createdBy: theirs, accounts })).toBe("others");
  });

  it("classifies a retained author the same way after an offline round trip", () => {
    // What the replica cache restores is the stored snapshot, scoped fields included.
    const restored = JSON.parse(JSON.stringify(theirs)) as SessionActor;
    const accounts = mergeReaderAccounts([], [verified]);
    expect(resolveOwnership({ createdBy: restored, accounts })).toBe("others");
  });

  it("prefers the live account and replaces the remembered one when another signs in", () => {
    const live = { origin: "https://hub.example", aliases: [], id: "u-other", memberId: null };
    const accounts = mergeReaderAccounts([live], [verified]);
    expect(accounts).toEqual([live]);
    expect(resolveOwnership({ createdBy: mine, accounts })).toBe("others");
  });

  it("keeps the remembered reader of a Hub the live list does not have", () => {
    const other: RememberedReader = {
      origin: "https://other.example",
      aliases: [],
      id: "u-me",
      memberId: null,
    };
    const accounts = mergeReaderAccounts(
      [{ origin: "https://hub.example", aliases: [], id: "u-me", memberId: "m-me" }],
      [other],
    );
    expect(accounts.map((account) => account.origin)).toEqual([
      "https://hub.example",
      "https://other.example",
    ]);
  });

  it("is forgotten on an explicit sign-out and replaced by a new sign-in", () => {
    const readers = rememberReader({}, verified);
    expect(forgetReader(readers, verified.origin)).toEqual({});
    const replaced = rememberReader(readers, { ...verified, id: "u-new" });
    expect(replaced[verified.origin]?.id).toBe("u-new");
    expect(forgetReader(readers, "https://unknown.example")).toBe(readers);
  });

  it("does not rewrite a record that has not changed", () => {
    const readers = rememberReader({}, verified);
    expect(rememberReader(readers, { ...verified })).toBe(readers);
  });
});

describe("recording verified readers", () => {
  const hub = "https://hub.example";
  const signedInAccount = {
    origin: hub,
    connectionOrigin: hub,
    state: { status: "active" } as never,
    signedIn: signedIn("u-me", "m-me"),
  };
  const signedOutAccount = {
    ...signedInAccount,
    state: { status: "signedOut" } as never,
    signedIn: null,
  };
  const unreadableAccount = { ...signedInAccount, state: null, signedIn: null };
  const memory = () => useReaderMemory.getState();
  const record = (accounts: Parameters<typeof recordVerifiedReaders>[0]) =>
    recordVerifiedReaders(accounts, memory());

  it("remembers a verified sign-in and keeps it through a Hub that cannot answer", () => {
    useReaderMemory.setState({ readers: {}, signedOut: {} });
    record([signedInAccount]);
    record([unreadableAccount]);
    expect(Object.keys(memory().readers)).toEqual([hub]);
  });

  it("lets an explicit sign-out win over a signed-in answer that is still in flight", () => {
    useReaderMemory.setState({ readers: {}, signedOut: {} });
    record([signedInAccount]);
    memory().forget(hub);
    // The refetch after sign-out failed, or an older one landed: still shows signed in.
    record([signedInAccount]);
    record([unreadableAccount]);
    expect(memory().readers).toEqual({});
    // The Hub answers that nobody is signed in; a later sign-in is a new one.
    record([signedOutAccount]);
    record([signedInAccount]);
    expect(Object.keys(memory().readers)).toEqual([hub]);
  });
});
