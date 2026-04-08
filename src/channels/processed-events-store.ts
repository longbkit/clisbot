import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DEFAULT_PROCESSED_EVENTS_PATH } from "../shared/paths.ts";

type ProcessedEventStatus = "processing" | "completed";

type ProcessedEventRecord = {
  status: ProcessedEventStatus;
  updatedAt: string;
};

type StoreDocument = {
  events: Record<string, ProcessedEventRecord>;
};

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PROCESSING_STALE_MS = 30 * 60 * 1000;

export class ProcessedEventsStore {
  private loaded = false;
  private document: StoreDocument = { events: {} };

  constructor(
    private readonly filePath = DEFAULT_PROCESSED_EVENTS_PATH,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {}

  private async load() {
    if (this.loaded) {
      return;
    }

    try {
      const text = await readFile(this.filePath, "utf8");
      this.document = JSON.parse(text);
    } catch {
      this.document = { events: {} };
    }

    this.loaded = true;
    this.prune();
  }

  private prune() {
    const now = Date.now();
    for (const [eventId, record] of Object.entries(this.document.events)) {
      const updatedAt = Date.parse(record.updatedAt);
      if (Number.isNaN(updatedAt)) {
        delete this.document.events[eventId];
        continue;
      }

      if (record.status === "processing" && now - updatedAt > PROCESSING_STALE_MS) {
        delete this.document.events[eventId];
        continue;
      }

      if (now - updatedAt > this.ttlMs) {
        delete this.document.events[eventId];
      }
    }
  }

  private async save() {
    await mkdir(this.filePath.replace(/\/[^/]+$/, ""), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.document, null, 2));
  }

  async getStatus(eventId: string) {
    await this.load();
    return this.document.events[eventId]?.status;
  }

  async markProcessing(eventId: string) {
    await this.load();
    this.document.events[eventId] = {
      status: "processing",
      updatedAt: new Date().toISOString(),
    };
    await this.save();
  }

  async markCompleted(eventId: string) {
    await this.load();
    this.document.events[eventId] = {
      status: "completed",
      updatedAt: new Date().toISOString(),
    };
    await this.save();
  }

  async clear(eventId: string) {
    await this.load();
    delete this.document.events[eventId];
    await this.save();
  }
}
