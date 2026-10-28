import { expect, it } from "vitest";
import { SessionOperationIdentitySchema } from "@clisbot/protocol/session-operation";
import { workflowSessionIdentity } from "./workflow-session-identity.js";

const owner = {
  kind: "user" as const,
  id: "author",
  memberId: "member-author",
  organizationId: "org",
  hubOrigin: "https://hub.example",
};
const initiator = { ...owner, id: "operator", memberId: "member-operator" };
const base = {
  workflowId: "workflow",
  triggerName: "trigger",
  organizationId: "org",
  triggerContext: {},
  ownerActor: owner,
};
it.each(["manual", "channel"])(
  "keeps the %s initiator separate from the revision owner",
  (provider) => {
    const identity = workflowSessionIdentity(
      {
        ...base,
        triggerContext: { provider, sessionIdentity: { actor: initiator, ownerActor: initiator } },
      },
      owner.hubOrigin,
    );
    expect(identity.actor).toEqual(initiator);
    expect(identity.ownerActor).toEqual(owner);
    expect(identity.ownerActor).not.toBe(owner);
  },
);
it("stamps automation while old/new optional identity schemas remain compatible", () => {
  const identity = workflowSessionIdentity(base, owner.hubOrigin);
  expect(identity.actor).toMatchObject({
    kind: "automation",
    id: "workflow",
    organizationId: "org",
  });
  expect(identity.actor).not.toHaveProperty("memberId");
  expect(SessionOperationIdentitySchema.parse(identity).ownerActor).toEqual(owner);
  const old = SessionOperationIdentitySchema.omit({ ownerActor: true });
  expect(old.parse(identity)).toEqual({ actor: identity.actor });
  expect(SessionOperationIdentitySchema.parse(old.parse(identity)).ownerActor).toBeUndefined();
});
it("keeps legacy intents unknown and ignores owner claims inside the trigger payload", () => {
  const identity = workflowSessionIdentity(
    {
      workflowId: base.workflowId,
      triggerName: base.triggerName,
      organizationId: base.organizationId,
      triggerContext: {
        provider: "manual",
        ownerActor: owner,
        sessionIdentity: { actor: initiator, ownerActor: owner },
      },
    },
    owner.hubOrigin,
  );
  expect(identity.actor).toEqual(initiator);
  expect(identity).not.toHaveProperty("ownerActor");
});
