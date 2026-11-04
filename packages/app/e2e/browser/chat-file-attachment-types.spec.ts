import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { attachFileFromMenu } from "../support/helpers/composer";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { getServerId } from "../support/helpers/server-id";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test.use({ e2eDaemonEnvironment: { CLISBOT_TAILSCALE_BIN: process.execPath } });
test.describe.configure({ timeout: 180_000 });

type BotClient = Pick<
  DaemonClient,
  | "createBot"
  | "archiveBot"
  | "createChat"
  | "archiveChat"
  | "removeProject"
  | "fetchChatTranscript"
  | "readFile"
  | "connect"
  | "close"
>;

const MB = 1024 * 1024;
// Synthetic bytes only; names and types match the reported cases.
const FILES = [
  { name: "clip.mp4", mimeType: "video/mp4", buffer: randomBytes(6 * MB) },
  { name: "report.pdf", mimeType: "application/pdf", buffer: randomBytes(300 * 1024) },
  { name: "bundle.zip", mimeType: "application/zip", buffer: randomBytes(2 * MB) },
  { name: "data.json", mimeType: "application/json", buffer: Buffer.from('{"ok":true}') },
];

async function withDirectBotChat(run: (client: BotClient, chatId: string) => Promise<void>) {
  const client = await connectDaemonClient<BotClient>({ clientIdPrefix: "chat-file-types" });
  let botId: string | undefined;
  let projectId: string | undefined;
  let chatId: string | undefined;
  try {
    const created = await client.createBot({
      name: "File types fixture",
      launch: {
        provider: "mock",
        model: "e2e-fast-stream",
        modeId: "load-test",
        featureValues: { mockAssistantResponses: ["Got it"] },
      },
    });
    if (!created.bot) throw new Error(created.error ?? "Bot creation failed");
    botId = created.bot.id;
    projectId = created.bot.projectId;
    const chat = await client.createChat({ botIds: [botId], kind: "direct" });
    if (!chat.chat) throw new Error(chat.error ?? "Chat creation failed");
    chatId = chat.chat.id;
    await run(client, chatId);
  } finally {
    if (chatId) await client.archiveChat({ chatId }).catch(() => undefined);
    if (botId) await client.archiveBot({ botId });
    if (projectId) await client.removeProject(projectId);
    await client.close();
  }
}

// One drop carrying every file, as a user drags a Finder selection; the composer refuses a
// second drop while the first one is still uploading.
async function dropFilesOnComposer(page: Page, files: typeof FILES): Promise<void> {
  const dataTransfer = await page.evaluateHandle(
    (entries) => {
      const transfer = new DataTransfer();
      for (const { name, mimeType, base64 } of entries) {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        transfer.items.add(new File([bytes], name, { type: mimeType }));
      }
      return transfer;
    },
    files.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      base64: file.buffer.toString("base64"),
    })),
  );
  const composerRoot = page.getByTestId("message-input-root").filter({ visible: true }).first();
  await expect(composerRoot).toBeVisible({ timeout: 10_000 });
  for (const type of ["dragenter", "dragover", "drop"]) {
    await composerRoot.dispatchEvent(type, { dataTransfer });
  }
  await dataTransfer.dispose();
}

async function sentLine(client: BotClient, chatId: string) {
  const { lines } = await client.fetchChatTranscript({ chatId });
  return lines.find((line) => line.text === "Files attached");
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

for (const via of ["menu", "drop"] as const) {
  test(`Bot chat sends MP4, PDF, zip and JSON chosen by ${via}`, async ({ page }) => {
    const errors = collectErrors(page);
    await withDirectBotChat(async (client, chatId) => {
      await page.goto(`/h/${getServerId()}/chat/${chatId}`);
      const scope = page.getByTestId("chat-composer");
      const input = scope.getByRole("textbox").last();
      await expect(input).toBeEditable({ timeout: 30_000 });
      if (via === "menu") for (const file of FILES) await attachFileFromMenu(page, file);
      else await dropFilesOnComposer(page, FILES);
      await expect(scope.getByTestId("composer-file-attachment-pill")).toHaveCount(FILES.length, {
        timeout: 30_000,
      });
      await input.fill("Files attached");
      await scope.getByTestId("composer-send-button").click();
      await expect
        .poll(async () => (await sentLine(client, chatId))?.attachments?.length ?? 0, {
          timeout: 60_000,
        })
        .toBe(FILES.length);
      const line = (await sentLine(client, chatId))!;
      for (const file of FILES) {
        const stored = line.attachments!.find(
          (attachment) => attachment.type === "uploaded_file" && attachment.fileName === file.name,
        );
        if (stored?.type !== "uploaded_file") throw new Error(`Missing ${file.name}`);
        expect(stored.mimeType).toBe(file.mimeType);
        expect(stored.size).toBe(file.buffer.byteLength);
        const read = await client.readFile(
          stored.path.slice(0, stored.path.lastIndexOf("/")),
          stored.path,
        );
        expect(Buffer.from(read.bytes).equals(file.buffer)).toBe(true);
      }
    });
    expect(errors.filter((text) => /upload|attachment/i.test(text))).toEqual([]);
  });
}

test("agent composer sends MP4, PDF, zip and JSON chosen from the menu", async ({ page }) => {
  const errors = collectErrors(page);
  const agent = await seedMockAgentWorkspace({ repoPrefix: "file-types-", title: "File types" });
  try {
    await openAgentRoute(page, agent);
    const input = page.getByTestId("message-input-root").filter({ visible: true }).first();
    await expect(input).toBeVisible({ timeout: 30_000 });
    for (const file of FILES) await attachFileFromMenu(page, file);
    await expect(
      page.getByTestId("composer-file-attachment-pill").filter({ visible: true }),
    ).toHaveCount(FILES.length, { timeout: 30_000 });
    await input.getByRole("textbox").fill("Agent files attached");
    await input.getByRole("textbox").press("Enter");
    const sent = page.getByTestId("user-message").filter({ hasText: "Agent files attached" });
    await expect(sent).toBeVisible({ timeout: 30_000 });
    for (const file of FILES) await expect(sent).toContainText(file.name);
    await expect(page.getByText(/upload failed|failed to upload/i)).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
  expect(errors.filter((text) => /upload|attachment/i.test(text))).toEqual([]);
});
