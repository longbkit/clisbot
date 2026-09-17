import { memo, useState, useCallback, useMemo } from "react";
import { Image, Text, View } from "react-native";
import { Bot, UserRound } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FOCUSED_PANE_PLACEMENT, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { ACTOR_AVATAR_SIZE, ACTOR_INLINE_AVATAR_SIZE } from "./actor-metrics";
import {
  actorLabel,
  resolveActorAvatarPresentation,
  type ActorAvatarPresentation,
} from "./actor-presentation";
import { usePersonProfile } from "./person";

export { actorLabel };

const ThemedAgentBotIcon = withUnistyles(Bot, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const ThemedSelfIcon = withUnistyles(UserRound, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

/** Square footprint for a face at any size; the radius tracks half the side. */
function avatarMetrics(size: number): { width: number; height: number; borderRadius: number } {
  return { width: size, height: size, borderRadius: size / 2 };
}

function AgentFaceIcon({ size }: { size: number }) {
  return <ThemedAgentBotIcon size={Math.round(size * 0.5)} />;
}

/**
 * The agent's default face: a bot glyph in a rounded badge. Deliberately not
 * a monogram so it never reads as one of the people in the conversation.
 */
export const AgentFace = memo(function AgentFace({ size = ACTOR_AVATAR_SIZE }: { size?: number }) {
  return (
    <View style={[styles.agentFace, avatarMetrics(size)]} accessibilityLabel="Agent">
      <AgentFaceIcon size={size} />
    </View>
  );
});

/**
 * The local reader's face when no verified account can name them: a neutral
 * person badge, never a monogram that could read as one of the people in the
 * conversation.
 */
export const SelfFace = memo(function SelfFace({ size = ACTOR_AVATAR_SIZE }: { size?: number }) {
  return (
    <View style={[styles.agentFace, avatarMetrics(size)]} accessibilityLabel="You">
      <ThemedSelfIcon size={Math.round(size * 0.5)} />
    </View>
  );
});

function InitialsFace({
  presentation,
  label,
  size,
}: {
  presentation: ActorAvatarPresentation;
  label: string;
  size: number;
}) {
  if (presentation.kind !== "initials") return null;
  return (
    <View
      style={[avatarMetrics(size), styles.initials, { backgroundColor: presentation.color }]}
      accessibilityLabel={label}
    >
      <Text style={[styles.initialsText, { fontSize: Math.max(10, Math.round(size * 0.42)) }]}>
        {presentation.label}
      </Text>
    </View>
  );
}

/**
 * The person's current face. The snapshot's `avatarUrl` is what it looked like
 * when they spoke, so the roster wins where the reader can see it — a profile
 * picture changed today shows on every message they ever sent.
 */
export const ActorAvatar = memo(function ActorAvatar({
  actor,
  size = ACTOR_AVATAR_SIZE,
}: {
  actor: SessionActor;
  size?: number;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const { actor: person } = usePersonProfile(actor);
  const label = actorLabel(person);
  const source = useMemo(() => ({ uri: person.avatarUrl }), [person.avatarUrl]);
  // Only the currently loaded URL can have failed; a fresh avatarUrl retries.
  const imageFailed = person.avatarUrl !== undefined && failedUrl === person.avatarUrl;
  const presentation = useMemo(
    () => resolveActorAvatarPresentation(person, imageFailed),
    [person, imageFailed],
  );
  const handleError = useCallback(() => setFailedUrl(person.avatarUrl ?? null), [person.avatarUrl]);
  const imageStyle = useMemo(() => [avatarMetrics(size), styles.image], [size]);
  if (presentation.kind === "image")
    return (
      <Image source={source} style={imageStyle} onError={handleError} accessibilityLabel={label} />
    );
  return <InitialsFace presentation={presentation} label={label} size={size} />;
});

function useOpenActorProfile(actor: SessionActor, serverId: string, workspaceId: string) {
  const openTab = useWorkspaceLayoutStore((state) => state.openTab);
  return useCallback(() => {
    const workspaceKey = buildWorkspaceTabPersistenceKey({
      serverId,
      workspaceId,
    });
    if (workspaceKey)
      openTab({
        workspaceKey,
        target: { kind: "user_profile", actor },
        intent: "reveal",
        placement: FOCUSED_PANE_PLACEMENT,
      });
  }, [actor, serverId, workspaceId, openTab]);
}

/** The actor's face as a control: hover shows the identity, press opens the profile tab. */
export const SessionActorAvatar = memo(function SessionActorAvatar({
  actor,
  serverId,
  workspaceId,
  size = ACTOR_AVATAR_SIZE,
}: {
  actor: SessionActor;
  serverId: string;
  workspaceId: string;
  size?: number;
}) {
  const openProfile = useOpenActorProfile(actor, serverId, workspaceId);
  const { actor: person } = usePersonProfile(actor);
  return (
    <Tooltip>
      <TooltipTrigger
        onPress={openProfile}
        accessibilityRole="button"
        accessibilityLabel={`Open profile: ${actorLabel(person)} (${actor.id})`}
      >
        <ActorAvatar actor={actor} size={size} />
      </TooltipTrigger>
      <TooltipContent>
        <Text style={styles.text}>{actor.id}</Text>
      </TooltipContent>
    </Tooltip>
  );
});

const UNRECORDED_SENDER_NOTE =
  "Unknown user: this message has no recorded sender, so it is shown with your account.";

/**
 * The face of a confirmed message nobody recorded a sender for. Hover (or tap on
 * mobile) discloses that, and it never opens the reader's own profile as if they
 * wrote the message.
 */
export const UnrecordedSenderAvatar = memo(function UnrecordedSenderAvatar({
  actor,
}: {
  actor: SessionActor;
}) {
  return (
    <Tooltip enabledOnMobile>
      <TooltipTrigger accessibilityLabel={UNRECORDED_SENDER_NOTE} testID="unrecorded-sender-avatar">
        <ActorAvatar actor={actor} />
      </TooltipTrigger>
      <TooltipContent>
        <Text style={styles.text}>{UNRECORDED_SENDER_NOTE}</Text>
      </TooltipContent>
    </Tooltip>
  );
});

/**
 * The actor's face and name as plain content, for a surface whose own press target owns the
 * whole line — a sidebar workspace row or session line. A control here would take the press
 * meant for the row, and the profile is a press away inside the session anyway.
 */
export const SessionActorName = memo(function SessionActorName({ actor }: { actor: SessionActor }) {
  const { actor: person } = usePersonProfile(actor);
  return (
    <View style={styles.label}>
      <ActorAvatar actor={actor} size={ACTOR_INLINE_AVATAR_SIZE} />
      <Text style={styles.text}>{actorLabel(person)}</Text>
    </View>
  );
});

/** The same name as a control: hover shows the identity, press opens the profile tab. */
export const SessionActorLabel = memo(function SessionActorLabel({
  actor,
  serverId,
  workspaceId,
}: {
  actor: SessionActor;
  serverId: string;
  workspaceId: string;
}) {
  const openProfile = useOpenActorProfile(actor, serverId, workspaceId);
  const { actor: person } = usePersonProfile(actor);
  return (
    <Tooltip>
      <TooltipTrigger
        onPress={openProfile}
        accessibilityRole="button"
        accessibilityLabel={`Open profile: ${actorLabel(person)} (${actor.id})`}
      >
        <SessionActorName actor={actor} />
      </TooltipTrigger>
      <TooltipContent>
        <Text style={styles.text}>{actor.id}</Text>
      </TooltipContent>
    </Tooltip>
  );
});

const styles = StyleSheet.create((theme) => ({
  image: {
    // A surface behind an image that has not decoded yet, so the row keeps its
    // shape instead of flashing transparent before the avatar arrives.
    backgroundColor: theme.colors.surface2,
  },
  agentFace: {
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    alignItems: "center",
    justifyContent: "center",
  },
  initialsText: {
    color: theme.colors.palette.white,
    fontWeight: theme.fontWeight.medium,
  },
  label: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 24,
  },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
