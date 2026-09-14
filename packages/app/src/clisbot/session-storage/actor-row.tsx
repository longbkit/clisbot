import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import {
  ACTOR_AVATAR_SIZE,
  ACTOR_CONTENT_INSET,
  ACTOR_GUTTER_GAP,
  ACTOR_NAME_CONTENT_GAP,
  ACTOR_NAME_ROW_HEIGHT,
  ACTOR_NAME_ROW_OFFSET,
} from "./actor-metrics";

interface ActorResponseRowProps {
  face: ReactNode;
  name?: string | null;
  /** Render avatar and name placeholders while the identity is still unknown. */
  loading?: boolean;
  /** Whether this row opens a group and therefore owns the face and name. */
  opensGroup?: boolean;
  children: ReactNode;
  alignRight?: boolean;
}

function useSkeletonOpacity() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);
  return pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.8] });
}

function ActorAvatarSkeleton() {
  const opacity = useSkeletonOpacity();
  return (
    <Animated.View
      style={[styles.avatarSkeleton, { opacity }]}
      testID="actor-avatar-skeleton"
      accessibilityLabel="Loading sender avatar"
    />
  );
}

function ActorNameSkeleton() {
  const opacity = useSkeletonOpacity();
  return (
    <Animated.View
      style={[styles.nameSkeleton, { opacity }]}
      testID="actor-name-skeleton"
      accessibilityLabel="Loading sender name"
    />
  );
}

function ActorFaceCell({
  face,
  loading,
  visible,
}: {
  face: ReactNode;
  loading: boolean;
  visible: boolean;
}): ReactNode {
  if (!visible) return null;
  if (loading) return <ActorAvatarSkeleton />;
  return face;
}

function ActorNameCell({
  name,
  loading,
  visible,
}: {
  name: string | null | undefined;
  loading: boolean;
  visible: boolean;
}) {
  if (!visible) return null;
  if (loading) return <ActorNameSkeleton />;
  return (
    <Text style={styles.name} numberOfLines={1}>
      {name}
    </Text>
  );
}

/**
 * A chat row: the sender's face in a fixed gutter beside the content, and the
 * sender name on its own line flush with the content edge.
 *
 * The face top-aligns with the content itself — the bubble for a person, the
 * first text block for the agent — not with the name above it, so the gutter
 * carries the name row as padding. Continuation rows of the same sender keep
 * the empty gutter so the content column never shifts.
 */
export function ActorResponseRow({
  face,
  name,
  loading = false,
  opensGroup = true,
  children,
  alignRight,
}: ActorResponseRowProps) {
  const named = opensGroup && (loading || Boolean(name));
  return (
    <View style={[styles.row, alignRight ? styles.rowRight : null]} testID="actor-response-row">
      <View
        style={[styles.gutter, named ? styles.gutterBelowName : null]}
        testID="actor-response-gutter"
      >
        <ActorFaceCell face={face} loading={loading} visible={opensGroup} />
      </View>
      <View style={[styles.content, alignRight ? styles.contentRight : null]}>
        <ActorNameCell name={name} loading={loading} visible={named} />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // flex: 1 so the row spans its parent and pins the gutter to the left,
  // even when the parent row right-aligns its content (own user messages).
  row: {
    flexDirection: "row",
    justifyContent: "flex-start",
    gap: ACTOR_GUTTER_GAP,
    flex: 1,
    width: "100%",
  },
  // Reversed row: main-start is the right edge, so flex-start pins the pair right.
  rowRight: { justifyContent: "flex-start", flexDirection: "row-reverse", alignSelf: "stretch" },
  gutter: {
    width: ACTOR_AVATAR_SIZE,
    flexShrink: 0,
  },
  // Mirrors the stream item wrapper's content column so the footer inside keeps
  // its own centring a no-op and simply lands on the gutter's right edge.
  gutterInset: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    paddingLeft: ACTOR_CONTENT_INSET,
  },
  /** Drops the face past the name line so it meets the top of the content. */
  gutterBelowName: {
    paddingTop: ACTOR_NAME_ROW_OFFSET,
  },
  content: {
    flexShrink: 1,
    minWidth: 0,
    alignItems: "flex-start",
    maxWidth: "100%",
  },
  contentRight: { alignItems: "flex-end" },
  name: {
    height: ACTOR_NAME_ROW_HEIGHT,
    lineHeight: ACTOR_NAME_ROW_HEIGHT,
    marginBottom: ACTOR_NAME_CONTENT_GAP,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    overflow: "hidden",
  },
  avatarSkeleton: {
    width: ACTOR_AVATAR_SIZE,
    height: ACTOR_AVATAR_SIZE,
    borderRadius: ACTOR_AVATAR_SIZE / 2,
    backgroundColor: theme.colors.surface2,
  },
  nameSkeleton: {
    width: 64,
    height: ACTOR_NAME_ROW_HEIGHT,
    marginBottom: ACTOR_NAME_CONTENT_GAP,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
  },
}));

/**
 * Holds the gutter's width for content that belongs to a response but renders
 * outside its rows, such as a turn footer. A padding rather than a row: these
 * footers centre themselves on the stream's content column, and nesting them
 * in a row would re-centre them against a narrower parent.
 */
export function ActorGutterInset({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}): ReactNode {
  if (!enabled) return children;
  return <View style={styles.gutterInset}>{children}</View>;
}
