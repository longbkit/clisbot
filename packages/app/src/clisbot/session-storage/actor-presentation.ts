import { deriveIdentityColorName, identityColor } from "@/styles/identity-colors";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
import { nameInitials } from "@/utils/name-initials";

export type ActorAvatarPresentation =
  | { kind: "image"; url: string }
  | { kind: "initials"; color: string; label: string };

export function actorLabel(actor: SessionActor): string {
  // "Automation" is the product name for a Hub Trigger/Workflow (docs/glossary.md); an
  // automation without a name must fall back to it rather than leak its opaque id.
  if (actor.kind === "automation") return actor.displayName || "Automation";
  if (actor.kind === "system") return "Assistant";
  return actor.displayName || actor.id;
}

/**
 * Every actor gets a face: the profile image when one is on record, otherwise a
 * deterministic monogram so group chats read as a set of people. Seeding the
 * color with `actor.id` (never the name) keeps one actor the same color even
 * after their display name changes.
 */
export function resolveActorAvatarPresentation(
  actor: SessionActor,
  imageFailed: boolean,
): ActorAvatarPresentation {
  if (actor.avatarUrl && !imageFailed) return { kind: "image", url: actor.avatarUrl };
  const label = actorLabel(actor);
  return {
    kind: "initials",
    color: identityColor(deriveIdentityColorName(actor.id)),
    label: nameInitials(label, actor.id.at(0)),
  };
}

/**
 * Whether `actor` is the signed-in Hub account. Hub actor IDs are the Hub
 * `users.id`, which is the same id the app's signed-in account exposes, so the
 * match is a direct id comparison — scoped to the hub origin when both sides
 * record one, since ids are per-hub. Not being signed in means "not me":
 * without an account we cannot tell, and messages keep the group form rather
 * than claiming to be the reader.
 */
export function isOwnActor(
  actor: SessionActor,
  hubAccount: { id: string | null | undefined; origin: string | null } | null | undefined,
): boolean {
  if (actor.kind !== "user" || !hubAccount?.id || actor.id !== hubAccount.id) return false;
  if (actor.hubOrigin && hubAccount.origin && actor.hubOrigin !== hubAccount.origin) return false;
  return true;
}

interface AccountIdentity {
  id: string;
  name: string;
  email: string;
}

/**
 * Who wrote a message, as far as the client can tell.
 *
 * - `ready`: the recorded sender snapshot, or the signed-in account when the
 *   message carries no sender (the common case for local sends).
 * - `loading`: a sender-less message while the account is still resolving. The
 *   row should hold a placeholder rather than guess an identity.
 * - `unknown`: a sender-less message with no verified account. The UI keeps
 *   the right-hand layout, but omits the name and avatar.
 */
export type MessageSenderResolution =
  | { state: "ready"; actor: SessionActor; isOwn: boolean }
  | { state: "loading"; isOwn: true }
  | { state: "unknown"; isOwn: false };

export function resolveMessageSender(input: {
  sender: SessionActor | undefined;
  account: AccountIdentity | null;
  accountOrigin: string | null;
  accountLoading: boolean;
}): MessageSenderResolution {
  const { sender, account, accountOrigin, accountLoading } = input;
  if (sender) {
    return {
      state: "ready",
      actor: sender,
      isOwn: isOwnActor(sender, { id: account?.id, origin: accountOrigin }),
    };
  }
  if (account) {
    return {
      state: "ready",
      isOwn: true,
      actor: {
        kind: "user",
        id: account.id,
        displayName: account.name || account.email,
        ...(accountOrigin ? { hubOrigin: accountOrigin } : {}),
      },
    };
  }
  if (accountLoading) return { state: "loading", isOwn: true };
  // Without a recorded sender or a verified account, never claim the message
  // belongs to the current reader. This is common when viewing a shared
  // conversation while signed out.
  return { state: "unknown", isOwn: false };
}
