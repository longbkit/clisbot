import { deriveIdentityColorName, identityColor } from "@/styles/identity-colors";
import { sessionParticipantKey, type SessionActor } from "@getpaseo/protocol/session-authorship";
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
 * color with the participant key (never the name) keeps one person the same
 * color after a rename, and keeps them one person across the channels they
 * speak through — a channel snapshot carries its provider identity in `id`, so
 * seeding with `id` would give the same human a face per channel.
 */
export function resolveActorAvatarPresentation(
  actor: SessionActor,
  imageFailed: boolean,
): ActorAvatarPresentation {
  if (actor.avatarUrl && !imageFailed) return { kind: "image", url: actor.avatarUrl };
  const label = actorLabel(actor);
  return {
    kind: "initials",
    color: identityColor(deriveIdentityColorName(sessionParticipantKey(actor))),
    label: nameInitials(label, actor.id.at(0)),
  };
}

/** The signed-in reader, as much of their identity as the app can name. */
export interface HubAccountIdentity {
  id: string | null | undefined;
  origin: string | null;
  /** The reader's membership in the active organization, when one is resolved. */
  memberId?: string | null;
}

/**
 * Whether `actor` is the signed-in Hub account.
 *
 * Two snapshots can name the same person by different ids: an app snapshot uses
 * the Hub `users.id`, while a channel snapshot keeps the provider identity
 * (`slack:U…`) and carries the verified link in `memberId`. So the Member link
 * decides whenever both sides carry one, and the id comparison covers the rest —
 * including a reader whose membership the app has not resolved. Not being signed in means "not me": without an account we cannot
 * tell, and messages keep the group form rather than claiming to be the reader.
 *
 * Deliberately more forgiving than `sessionParticipantKey`, which is the
 * grouping key for two *snapshots*. Here one side is the live account, so a
 * snapshot written before its scope was complete still matches its reader.
 */
export function isOwnActor(
  actor: SessionActor,
  hubAccount: HubAccountIdentity | null | undefined,
): boolean {
  if (actor.kind !== "user" || !hubAccount) return false;
  if (actor.hubOrigin && hubAccount.origin && actor.hubOrigin !== hubAccount.origin) return false;
  if (actor.memberId && hubAccount.memberId) return actor.memberId === hubAccount.memberId;
  return !!hubAccount.id && actor.id === hubAccount.id;
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
 *   message carries no sender (the common case for local sends). `unrecorded`
 *   marks that fallback on a message the daemon already confirmed: nothing
 *   recorded who sent it, so the account shown is a guess the UI must disclose.
 * - `loading`: a sender-less message while the account is still resolving. The
 *   row should hold a placeholder rather than guess an identity.
 * - `unknown`: a sender-less message with no verified account. The UI keeps
 *   the right-hand layout, but omits the name and avatar.
 */
export type MessageSenderResolution =
  | { state: "ready"; actor: SessionActor; isOwn: boolean; unrecorded: boolean }
  | { state: "loading"; isOwn: true }
  | { state: "unknown"; isOwn: false };

export function resolveMessageSender(input: {
  sender: SessionActor | undefined;
  account: AccountIdentity | null;
  accountOrigin: string | null;
  accountMemberId?: string | null;
  accountLoading: boolean;
  /** The daemon has confirmed this message (it holds a timeline position). */
  confirmed?: boolean;
}): MessageSenderResolution {
  const { sender, account, accountOrigin, accountMemberId, accountLoading } = input;
  const confirmed = input.confirmed ?? false;
  if (sender) {
    return {
      state: "ready",
      actor: sender,
      isOwn: isOwnActor(sender, {
        id: account?.id,
        origin: accountOrigin,
        memberId: accountMemberId,
      }),
      unrecorded: false,
    };
  }
  if (account) {
    return {
      state: "ready",
      isOwn: true,
      unrecorded: confirmed,
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
