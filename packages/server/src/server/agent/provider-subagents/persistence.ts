import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  TimelineDocumentReadOptions,
} from "../agent-timeline-store-types.js";
import { FileAgentTimelineStore } from "../session-storage/file-agent-timeline-store.js";
import { withSessionFileLease } from "../../file-upload/session-file-activity.js";
import { writeDurableJson } from "../session-storage/durable-file.js";
import type { ProviderSubagentDescriptor, ProviderSubagentStoreEvent } from "./store.js";
import { descriptorBytes, SUBAGENT_METADATA_LIMITS } from "./metadata-limits.js";

/** Provider IDs are opaque. Base64url retains the exact ID without exposing path separators. */
export function encodedSubagentId(id: string): string {
  if (!id) throw new Error("Provider subagent ID must not be empty");
  return Buffer.from(id, "utf8").toString("base64url");
}

export class ProviderSubagentPersistence {
  readonly timelines: FileAgentTimelineStore;
  constructor(private readonly resolveParentDirectory: (parentAgentId: string) => Promise<string>) {
    this.timelines = new FileAgentTimelineStore(async (key) => {
      const [parentAgentId, subagentId] = JSON.parse(key) as [string, string];
      return this.directory(parentAgentId, subagentId);
    });
  }

  private async withParentLease<T>(parentAgentId: string, operation: () => Promise<T>): Promise<T> {
    const directory = await this.resolveParentDirectory(parentAgentId);
    return withSessionFileLease(directory, operation);
  }

  private key(parentAgentId: string, subagentId: string): string {
    return JSON.stringify([parentAgentId, subagentId]);
  }
  async directory(parentAgentId: string, subagentId: string): Promise<string> {
    return path.join(
      await this.resolveParentDirectory(parentAgentId),
      "subagents",
      encodedSubagentId(subagentId),
    );
  }
  async hasData(parentAgentId: string): Promise<boolean> {
    try {
      return (
        await fs.stat(path.join(await this.resolveParentDirectory(parentAgentId), "subagents"))
      ).isDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  async list(parentAgentId: string): Promise<ProviderSubagentDescriptor[]> {
    const directory = path.join(await this.resolveParentDirectory(parentAgentId), "subagents");
    let entries;
    try {
      entries = await fs.opendir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const result: ProviderSubagentDescriptor[] = [];
    let bytes = 0;
    for await (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let raw: string;
      try {
        try {
          const removalPath = path.join(directory, entry.name, "removed.json");
          if ((await fs.stat(removalPath)).size > 4096)
            throw new Error("Invalid provider subagent removal marker");
          const removal = JSON.parse(await fs.readFile(removalPath, "utf8")) as {
            removed?: boolean;
          };
          if (removal.removed !== false) continue;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const recordPath = path.join(directory, entry.name, "session.json");
        const size = (await fs.stat(recordPath)).size;
        if (
          size > SUBAGENT_METADATA_LIMITS.descriptorBytes ||
          bytes + size > SUBAGENT_METADATA_LIMITS.cacheBytes
        )
          throw new Error("Provider subagent metadata exceeds read byte budget");
        raw = await fs.readFile(recordPath, "utf8");
        bytes += size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const descriptor = JSON.parse(raw) as ProviderSubagentDescriptor;
      if (
        descriptor.parentAgentId !== parentAgentId ||
        encodedSubagentId(descriptor.id) !== entry.name
      )
        throw new Error("Provider subagent record does not match its owning session");
      result.push(descriptor);
    }
    return result.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
  async save(event: ProviderSubagentStoreEvent): Promise<void> {
    if (event.type === "upsert") descriptorBytes(event.subagent);
    event = structuredClone(event);
    const parentAgentId =
      event.type === "upsert" ? event.subagent.parentAgentId : event.parentAgentId;
    const parentDirectory = await this.resolveParentDirectory(parentAgentId);
    return withSessionFileLease(parentDirectory, () => this.saveWhileLeased(event), 1024 * 1024);
  }
  private async saveWhileLeased(event: ProviderSubagentStoreEvent): Promise<void> {
    if (event.type === "upsert") {
      await writeDurableJson(
        path.join(
          await this.directory(event.subagent.parentAgentId, event.subagent.id),
          "session.json",
        ),
        event.subagent,
      );
      await writeDurableJson(
        path.join(
          await this.directory(event.subagent.parentAgentId, event.subagent.id),
          "removed.json",
        ),
        { removed: false },
      );
    } else if (event.type === "timeline") {
      await this.timelines.bulkInsert(this.key(event.parentAgentId, event.subagentId), [event.row]);
    } else {
      // A provider removal is presentation state; retain observed history until the parent is deleted.
      const directory = await this.directory(event.parentAgentId, event.subagentId);
      await writeDurableJson(path.join(directory, "removed.json"), {
        removed: true,
        removedAt: new Date().toISOString(),
      });
    }
  }
  async state(
    parentAgentId: string,
    subagentId: string,
  ): Promise<{ epoch: string; nextSeq: number }> {
    const key = this.key(parentAgentId, subagentId);
    return this.withParentLease(parentAgentId, async () => ({
      epoch: await this.timelines.getEpoch(key),
      nextSeq: (await this.timelines.getLatestCommittedSeq(key)) + 1,
    }));
  }
  async fetch(
    parentAgentId: string,
    subagentId: string,
    options?: AgentTimelineFetchOptions,
  ): Promise<AgentTimelineFetchResult> {
    return this.withParentLease(parentAgentId, () =>
      this.timelines.fetchCommitted(this.key(parentAgentId, subagentId), options),
    );
  }
  async fetchProjected(
    parentAgentId: string,
    subagentId: string,
    options?: AgentTimelineFetchOptions,
  ) {
    return this.withParentLease(parentAgentId, () =>
      this.timelines.fetchProjectedCommitted(this.key(parentAgentId, subagentId), options),
    );
  }
  async flush(): Promise<void> {
    await this.timelines.flush();
  }
  async readPayload(
    parentAgentId: string,
    subagentId: string,
    options: TimelineDocumentReadOptions,
  ) {
    return this.withParentLease(parentAgentId, () =>
      this.timelines.readProjectedPayload(this.key(parentAgentId, subagentId), options),
    );
  }
  async readSourceRanges(
    parentAgentId: string,
    subagentId: string,
    options: TimelineDocumentReadOptions,
  ) {
    return this.withParentLease(parentAgentId, () =>
      this.timelines.readProjectedSourceRanges(this.key(parentAgentId, subagentId), options),
    );
  }
}
