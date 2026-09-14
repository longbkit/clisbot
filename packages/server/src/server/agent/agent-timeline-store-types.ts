import type { AgentPermissionResponseRecord } from "@getpaseo/protocol/session-authorship";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type { ProjectedTimelinePageSelection } from "./timeline-projection.js";
import type { TimelinePromptIndex } from "./timeline-prompt-index.js";

export interface AgentTimelineRow {
  seq: number;
  timestamp: string;
  item: AgentTimelineItem;
  readonly turnId?: string;
  readonly providerMessageId?: string;
}

export interface AgentTimelineCursor {
  epoch: string;
  seq: number;
}

export type AgentTimelineFetchDirection = "tail" | "before" | "after";

export interface AgentTimelineFetchOptions {
  pagingMode?: "source_ranges";
  allowDeferredPayloads?: true;
  direction?: AgentTimelineFetchDirection;
  cursor?: AgentTimelineCursor;
  /**
   * Number of canonical rows to return.
   * - undefined: store default
   * - 0: all rows in the selected window
   */
  limit?: number;
}

export interface AgentTimelineWindow {
  minSeq: number;
  maxSeq: number;
  nextSeq: number;
}
export interface TimelineDocumentReadOptions {
  epoch: string;
  id: string;
  offset?: number;
  limit?: number;
  seq?: number;
}
export interface TimelineDocumentPage {
  text: string;
  nextOffset: number | null;
  totalBytes: number;
}
export interface TimelineSourceRangePage {
  ranges: { startSeq: number; endSeq: number }[];
  nextOffset: number | null;
  totalCount: number;
}

export interface AgentTimelineFetchResult {
  epoch: string;
  direction: AgentTimelineFetchDirection;
  reset: boolean;
  staleCursor: boolean;
  gap: boolean;
  window: AgentTimelineWindow;
  hasOlder: boolean;
  hasNewer: boolean;
  rows: AgentTimelineRow[];
}

export interface AgentTimelineStore {
  listPromptIndex?(agentId: string): Promise<TimelinePromptIndex>;
  readProjectedPayload?(
    agentId: string,
    options: TimelineDocumentReadOptions,
  ): Promise<TimelineDocumentPage>;
  readProjectedSourceRanges?(
    agentId: string,
    options: TimelineDocumentReadOptions,
  ): Promise<TimelineSourceRangePage>;
  setAuthorshipRecoveryRefill?(refill: () => Promise<readonly string[]>): void;
  requestAuthorshipRecoverySweep?(): void;
  scheduleAuthorshipRecovery?(agentId: string, prioritize?: boolean): boolean;
  recoverAuthorship?(
    agentId: string,
  ): Promise<import("./session-storage/session-summary.js").DurableSessionSummary>;
  writeMessageSubmission?(
    agentId: string,
    record: import("./session-storage/message-submissions.js").MessageSubmission,
  ): Promise<{
    record: import("./session-storage/message-submissions.js").MessageSubmission;
    created: boolean;
  }>;
  fetchProjectedCommitted?(
    agentId: string,
    options?: AgentTimelineFetchOptions,
  ): Promise<AgentTimelineFetchResult & ProjectedTimelinePageSelection>;
  getUserMessageByProviderId?(agentId: string, id: string): Promise<AgentTimelineRow | null>;
  replaceCommitted?(
    agentId: string,
    rows: readonly AgentTimelineRow[],
    options?: { epoch?: string },
  ): Promise<string>;
  resetCommitted?(agentId: string, options?: { epoch?: string }): Promise<string>;
  getEpoch?(agentId: string): Promise<string>;
  getSubmittedUserMessage?(
    agentId: string,
    clientMessageId: string,
  ): Promise<AgentTimelineRow | null>;
  readPermissionResponse?(
    agentId: string,
    id: string,
  ): Promise<AgentPermissionResponseRecord | null>;
  appendPermissionResponse?(
    agentId: string,
    record: AgentPermissionResponseRecord,
    identity?: import("./session-authorship.js").SessionOperationIdentity,
  ): Promise<void>;
  fetchPermissionResponses?(
    agentId: string,
    options?: { cursor?: number; limit?: number },
  ): Promise<{ records: AgentPermissionResponseRecord[]; nextCursor?: number }>;
  flush?(): Promise<void>;
  appendCommitted(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string; turnId?: string },
  ): Promise<AgentTimelineRow>;
  fetchCommitted(
    agentId: string,
    options?: AgentTimelineFetchOptions,
  ): Promise<AgentTimelineFetchResult>;
  getLatestCommittedSeq(agentId: string): Promise<number>;
  getCommittedRows(agentId: string): Promise<AgentTimelineRow[]>;
  getLastItem(agentId: string): Promise<AgentTimelineItem | null>;
  getLastAssistantMessage(agentId: string): Promise<string | null>;
  deleteAgent(agentId: string): Promise<void>;
  bulkInsert(agentId: string, rows: readonly AgentTimelineRow[]): Promise<void>;
  updateCommittedRow(agentId: string, row: AgentTimelineRow): Promise<void>;
}
