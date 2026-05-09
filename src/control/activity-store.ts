import { dirname } from "node:path";
import { fileExists, readTextFile, writeTextFile } from "../shared/fs.ts";
import { ensureDir, getDefaultActivityStorePath } from "../shared/paths.ts";

type ActivityRecord = {
  channel: "slack" | "telegram" | "zalo-bot";
  surface: string;
  agentId: string;
  updatedAt: string;
};

type ActivityDocument = {
  agents: Record<string, ActivityRecord>;
  channels: Record<string, ActivityRecord>;
};

export class ActivityStore {
  constructor(private readonly filePath = getDefaultActivityStorePath()) {}

  async record(params: {
    agentId: string;
    channel: "slack" | "telegram" | "zalo-bot";
    surface: string;
  }) {
    const document = await this.read();
    const next: ActivityRecord = {
      agentId: params.agentId,
      channel: params.channel,
      surface: params.surface,
      updatedAt: new Date().toISOString(),
    };

    document.agents[params.agentId] = next;
    document.channels[params.channel] = next;
    await this.write(document);
  }

  async read() {
    if (!(await fileExists(this.filePath))) {
      return {
        agents: {},
        channels: {},
      } satisfies ActivityDocument;
    }

    const text = await readTextFile(this.filePath);
    if (!text.trim()) {
      return {
        agents: {},
        channels: {},
      } satisfies ActivityDocument;
    }

    const parsed = JSON.parse(text) as Partial<ActivityDocument>;
    return {
      agents: parsed.agents ?? {},
      channels: parsed.channels ?? {},
    } satisfies ActivityDocument;
  }

  private async write(document: ActivityDocument) {
    await ensureDir(dirname(this.filePath));
    await writeTextFile(this.filePath, `${JSON.stringify(document, null, 2)}\n`);
  }
}
