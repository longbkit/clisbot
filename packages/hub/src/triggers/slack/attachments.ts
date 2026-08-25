import type {
  AttachmentResolver,
  AttachmentResolverInput,
} from "../../attachments/capabilities.js";
import type { SlackBotClient } from "./client.js";

export function createSlackAttachmentResolver(client: SlackBotClient): AttachmentResolver {
  return async (input) => {
    const locator = readSlackLocator(input);
    if (client.downloadAttachment === undefined) {
      throw new Error("Slack attachment download is unavailable");
    }
    return client.downloadAttachment({
      organizationId: input.organizationId,
      teamId: locator.teamId,
      fileId: locator.fileId,
    });
  };
}

function readSlackLocator(input: AttachmentResolverInput): { teamId: string; fileId: string } {
  if (!isRecord(input.locator)) {
    throw new Error("invalid Slack attachment locator");
  }
  const teamId = input.locator["teamId"];
  const fileId = input.locator["fileId"];
  if (
    typeof teamId !== "string" ||
    teamId.length === 0 ||
    typeof fileId !== "string" ||
    fileId.length === 0
  ) {
    throw new Error("invalid Slack attachment locator");
  }
  return { teamId, fileId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
