import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/stores/session-store";
import { timelinePageRetention, timelineRetentionKey } from "@/timeline/timeline-page-retention";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { SessionActorLabel, actorLabel } from "@/clisbot/session-storage/actor";
import type { StreamItem, TimelinePosition } from "@/types/stream";

const DOCUMENT_PAGE_BYTES = 4096;
const MAX_BACK_PAGES = 64;
interface DocumentPage {
  text: string;
  nextOffset?: number;
  offset: number;
  totalBytes: number;
}

/** The document stays on disk. This view holds one bounded UTF-8 page, without parsing its JSON. */
/** A tool call titles from its own payload; anything else from its kind. */
function documentTitle(item: StreamItem): string {
  if (item.kind !== "tool_call") return item.kind.replaceAll("_", " ");
  return item.payload.source === "agent" ? item.payload.data.name : item.payload.data.toolName;
}

/** Only a workspace-scoped sender can open a profile; otherwise the name is plain text. */
function DocumentSender({
  item,
  serverId,
  workspaceId,
}: {
  item: StreamItem;
  serverId: string;
  workspaceId: string | undefined;
}) {
  if (item.kind !== "user_message" || !item.sender) return null;
  if (!workspaceId) return <Text style={styles.text}>{actorLabel(item.sender)}</Text>;
  return <SessionActorLabel actor={item.sender} serverId={serverId} workspaceId={workspaceId} />;
}

export function DeferredTimelineItem({
  item,
  serverId,
  agentId,
  subagentId,
  workspaceId,
  refresh,
}: {
  item: StreamItem;
  serverId: string;
  agentId: string;
  subagentId?: string;
  workspaceId?: string;
  refresh: (position: TimelinePosition) => void;
}) {
  const descriptor = item.timelineCursor?.deferredPayload;
  const epoch = item.timelineCursor?.epoch;
  const [selected, setSelected] = useState<{
    epoch: string | undefined;
    descriptor: TimelinePosition["deferredPayload"];
  } | null>(null);
  const document =
    selected && selected.epoch === epoch ? (selected.descriptor ?? descriptor) : descriptor;
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const active = useRetainedPanelActive();
  const ownerId = useId();
  const [expanded, setExpanded] = useState(false);
  const [offset, setOffset] = useState(0);
  const [back, setBack] = useState<number[]>([]);
  const [page, setPage] = useState<DocumentPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshCurrent = useCallback(() => {
    if (item.timelineCursor) refresh(item.timelineCursor);
  }, [item.timelineCursor, refresh]);
  const toggle = useCallback(() => {
    if (!expanded) setSelected({ epoch, descriptor });
    setExpanded((value) => !value);
  }, [descriptor, epoch, expanded]);
  const loadCurrent = useCallback(() => {
    setSelected({ epoch, descriptor });
    setOffset(0);
    setBack([]);
  }, [descriptor, epoch]);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const first = useCallback(() => {
    setOffset(0);
    setBack([]);
  }, []);
  const previous = useCallback(() => {
    const value = back.at(-1);
    if (value !== undefined) {
      setOffset(value);
      setBack((values) => values.slice(0, -1));
    }
  }, [back]);
  const next = useCallback(() => {
    if (page?.nextOffset !== undefined) {
      setBack((values) => [...values, offset].slice(-MAX_BACK_PAGES));
      setOffset(page.nextOffset);
    }
  }, [page, offset]);
  useEffect(() => {
    setOffset(0);
    setBack([]);
    setPage(null);
    setError(null);
  }, [document?.id, epoch]);
  useEffect(() => {
    setPage(null);
    setLoading(false);
    setError(null);
    if (!expanded || !active || !document || !epoch || !client) return;
    const controller = new AbortController();
    const key = JSON.stringify([serverId, "timeline-document", agentId, subagentId, ownerId]);
    const dispose = timelinePageRetention.register(
      key,
      () => {
        setPage(null);
        setError("Document page was evicted. Reopen the document to load it again.");
      },
      timelineRetentionKey(serverId, agentId),
    );
    timelinePageRetention.setReading(key, true, "document");
    setLoading(true);
    void client
      .readTimelinePayload(agentId, {
        subagentId,
        epoch,
        id: document.id,
        offset,
        limit: DOCUMENT_PAGE_BYTES,
        signal: controller.signal,
      })
      .then((response) => {
        if (controller.signal.aborted) return undefined;
        const bytes = new TextEncoder().encode(response.text).byteLength * 2 + 2048;
        if (
          !timelinePageRetention.retain(key, {
            epoch,
            startSeq: 1,
            endSeq: 1,
            itemIds: ["document"],
            sourceSeqRanges: [],
            bytes,
            hasOlder: false,
          })
        )
          throw new Error("Document page exceeds the available memory budget");
        setPage({
          text: response.text,
          offset: response.offset,
          nextOffset: response.nextOffset ?? undefined,
          totalBytes: response.totalBytes,
        });
        return undefined;
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      dispose();
      setPage(null);
    };
  }, [active, agentId, client, document, epoch, expanded, offset, ownerId, serverId, subagentId]);
  if (!descriptor) return null;
  const title = documentTitle(item);
  return (
    <View style={styles.container} testID={`timeline-document-${item.id}`}>
      <Text style={styles.title}>{title}</Text>
      {item.kind === "tool_call" ? (
        <Text style={styles.text}>{item.payload.data.status}</Text>
      ) : null}
      <DocumentSender item={item} serverId={serverId} workspaceId={workspaceId} />
      <Text style={styles.text}>{item.timestamp.toLocaleString()}</Text>
      <Text style={styles.text}>Large item · {descriptor.byteLength.toLocaleString()} bytes</Text>
      <Button variant="ghost" size="sm" onPress={toggle} accessibilityState={accessibilityState}>
        View saved document
      </Button>
      {expanded ? (
        <View style={styles.document}>
          {document?.id !== descriptor.id ? (
            <Button variant="ghost" size="sm" onPress={loadCurrent}>
              View newer version
            </Button>
          ) : null}
          {loading ? (
            <Text style={styles.text} accessibilityLiveRegion="polite">
              Loading document page…
            </Text>
          ) : null}
          {error ? (
            <View>
              <Text style={styles.text} accessibilityRole="alert">
                Document unavailable: {error}
              </Text>
              <Button variant="ghost" size="sm" onPress={refreshCurrent}>
                Reload current item
              </Button>
            </View>
          ) : null}
          {page ? (
            <>
              <Text style={styles.text}>
                Saved item JSON · bytes {page.offset.toLocaleString()}–
                {(page.nextOffset ?? page.totalBytes).toLocaleString()} of{" "}
                {page.totalBytes.toLocaleString()}
              </Text>
              <Text selectable style={styles.documentText}>
                {page.text}
              </Text>
            </>
          ) : null}
          <View style={styles.navigation}>
            {offset > 0 ? (
              <Button variant="ghost" size="sm" onPress={first} disabled={loading}>
                First page
              </Button>
            ) : null}
            {back.length ? (
              <Button variant="ghost" size="sm" onPress={previous} disabled={loading}>
                Previous page
              </Button>
            ) : null}
            {page?.nextOffset !== undefined ? (
              <Button variant="ghost" size="sm" onPress={next} disabled={loading}>
                Next page
              </Button>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  container: { padding: theme.spacing[3], gap: theme.spacing[1] },
  document: { gap: theme.spacing[2] },
  navigation: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[1] },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  documentText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
