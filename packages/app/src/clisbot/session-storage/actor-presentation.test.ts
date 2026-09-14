import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
import { deriveIdentityColorName, identityColor } from "@/styles/identity-colors";
import {
  actorLabel,
  isOwnActor,
  resolveActorAvatarPresentation,
  resolveMessageSender,
  type ActorAvatarPresentation,
} from "./actor-presentation";

const longbkit: SessionActor = {
  kind: "user",
  id: "02ccc366-f702-40a7-9179-8b7f7cd98509",
  displayName: "longbkit",
  organizationId: "org",
  memberId: "member",
  hubOrigin: "https://hub.example",
};
const ngocLong: SessionActor = {
  kind: "user",
  id: "oWzlS92kXrvfoL9iPXAkbbHg1OR30St9",
  displayName: "Ngoc Long",
};

describe("actorLabel", () => {
  it("prefers the display name and never falls back to an opaque non-user id", () => {
    assert.equal(actorLabel(longbkit), "longbkit");
    // docs/glossary.md: "Automation" is the product name; "Bot"/"Job" are forbidden.
    assert.equal(actorLabel({ kind: "automation", id: "opaque-id" }), "Automation");
    assert.equal(
      actorLabel({ kind: "automation", id: "opaque-id", displayName: "Nightly sync" }),
      "Nightly sync",
    );
    assert.equal(actorLabel({ kind: "system", id: "daemon-7" }), "Assistant");
  });
});

describe("isOwnActor", () => {
  it("matches the signed-in account by id", () => {
    assert.equal(isOwnActor(longbkit, { id: longbkit.id, origin: null }), true);
    assert.equal(isOwnActor(longbkit, { id: "someone-else", origin: null }), false);
  });

  it("requires a user-kind actor and a known account", () => {
    assert.equal(
      isOwnActor({ kind: "automation", id: "bot-1" }, { id: "bot-1", origin: null }),
      false,
    );
    assert.equal(
      isOwnActor({ kind: "system", id: "daemon-7" }, { id: "daemon-7", origin: null }),
      false,
    );
    assert.equal(isOwnActor(longbkit, { id: null, origin: null }), false);
    assert.equal(isOwnActor(longbkit, null), false);
  });

  it("scopes an id match to the hub origin when both sides record one", () => {
    const withOrigin = { ...longbkit, hubOrigin: "https://hub.example" };
    assert.equal(isOwnActor(withOrigin, { id: longbkit.id, origin: "https://hub.example" }), true);
    assert.equal(
      isOwnActor(withOrigin, { id: longbkit.id, origin: "https://other.example" }),
      false,
    );
    // No recorded origin on either side: the id match stands.
    assert.equal(isOwnActor(longbkit, { id: longbkit.id, origin: "https://hub.example" }), true);
  });
});

describe("resolveActorAvatarPresentation", () => {
  it("renders the profile image when one is on record", () => {
    assert.deepEqual(
      resolveActorAvatarPresentation(
        { ...longbkit, avatarUrl: "https://hub.example/u/02ccc.png" },
        false,
      ),
      { kind: "image", url: "https://hub.example/u/02ccc.png" },
    );
  });

  it("falls back to a monogram without a profile image", () => {
    const presentation = resolveActorAvatarPresentation(longbkit, false);
    assert.deepEqual(presentation, {
      kind: "initials",
      color: expectedColor(longbkit.id),
      label: "L",
    });
  });

  it("falls back to the monogram when the image fails to load", () => {
    assert.equal(
      resolveActorAvatarPresentation(
        { ...longbkit, avatarUrl: "https://hub.example/404.png" },
        true,
      ).kind,
      "initials",
    );
  });

  it("keeps one actor on one color across labels and observers", () => {
    const renamed = { ...longbkit, displayName: "Long Luong" };
    assert.deepEqual(
      colorOf(resolveActorAvatarPresentation(longbkit, false)),
      colorOf(resolveActorAvatarPresentation(renamed, false)),
    );
  });

  it("gives distinct actors different colors and initials", () => {
    assert.notEqual(
      colorOf(resolveActorAvatarPresentation(longbkit, false)),
      colorOf(resolveActorAvatarPresentation(ngocLong, false)),
    );
    assert.equal(labelOf(resolveActorAvatarPresentation(ngocLong, false)), "NL");
  });
});

describe("resolveMessageSender", () => {
  const account = { id: "account-1", name: "Long", email: "long@example.com" };

  it("uses a recorded sender snapshot and marks the reader's own message", () => {
    assert.deepEqual(
      resolveMessageSender({
        sender: longbkit,
        account: { id: longbkit.id, name: "x", email: "x@example.com" },
        accountOrigin: null,
        accountLoading: false,
      }),
      { state: "ready", actor: longbkit, isOwn: true },
    );
    assert.deepEqual(
      resolveMessageSender({
        sender: longbkit,
        account,
        accountOrigin: null,
        accountLoading: false,
      }),
      { state: "ready", actor: longbkit, isOwn: false },
    );
  });

  it("falls back to the signed-in account when the message has no sender", () => {
    assert.deepEqual(
      resolveMessageSender({
        sender: undefined,
        account,
        accountOrigin: "https://hub",
        accountLoading: false,
      }),
      {
        state: "ready",
        isOwn: true,
        actor: { kind: "user", id: "account-1", displayName: "Long", hubOrigin: "https://hub" },
      },
    );
  });

  it("uses the email when the account has no name", () => {
    const resolved = resolveMessageSender({
      sender: undefined,
      account: { id: "account-1", name: "", email: "long@example.com" },
      accountOrigin: null,
      accountLoading: false,
    });
    assert.equal(resolved.state, "ready");
    if (resolved.state === "ready") assert.equal(resolved.actor.displayName, "long@example.com");
  });

  it("holds a loading placeholder instead of guessing while the account resolves", () => {
    assert.deepEqual(
      resolveMessageSender({
        sender: undefined,
        account: null,
        accountOrigin: null,
        accountLoading: true,
      }),
      { state: "loading", isOwn: true },
    );
  });

  it("does not claim a sender-less message for a signed-out reader", () => {
    assert.deepEqual(
      resolveMessageSender({
        sender: undefined,
        account: null,
        accountOrigin: null,
        accountLoading: false,
      }),
      { state: "unknown", isOwn: false },
    );
  });
});

function colorOf(presentation: ActorAvatarPresentation): string {
  assert.equal(presentation.kind, "initials");
  return presentation.color;
}
function labelOf(presentation: ActorAvatarPresentation): string {
  assert.equal(presentation.kind, "initials");
  return presentation.label;
}
function expectedColor(id: string): string {
  return identityColor(deriveIdentityColorName(id));
}
