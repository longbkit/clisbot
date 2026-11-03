import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import type { SeedDaemonClient } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { createTempDirectory, createTempGitRepo } from "../support/helpers/workspace";
import { ensureExplorerSidebar } from "../support/helpers/workspace-tabs";

// Never invoke the machine's real Tailscale during isolated Bot tests.
test.use({ e2eDaemonEnvironment: { CLISBOT_TAILSCALE_BIN: process.execPath } });
test.describe.configure({ timeout: 120_000 });

type BotClient = SeedDaemonClient &
  Pick<DaemonClient, "createBot" | "archiveBot" | "createChat" | "archiveChat">;

async function withDirectBotChat(
  project: { path: string },
  run: (chatId: string) => Promise<void>,
): Promise<void> {
  const client = await connectDaemonClient<BotClient>({ clientIdPrefix: "bot-chat-explorer" });
  let botId: string | undefined;
  let projectId: string | undefined;
  let chatId: string | undefined;
  try {
    const created = await client.createBot({
      name: "Explorer fixture",
      path: project.path,
      launch: {
        provider: "mock",
        model: "e2e-fast-stream",
        modeId: "load-test",
        featureValues: { mockAssistantResponses: ["Fixture ready"] },
      },
    });
    if (!created.bot) throw new Error(created.error ?? "Bot creation failed");
    botId = created.bot.id;
    projectId = created.bot.projectId;
    const chat = await client.createChat({ botIds: [botId], kind: "direct" });
    if (!chat.chat) throw new Error(chat.error ?? "Chat creation failed");
    chatId = chat.chat.id;
    await run(chatId);
  } finally {
    if (chatId) await client.archiveChat({ chatId }).catch(() => undefined);
    if (botId) await client.archiveBot({ botId });
    if (projectId) await client.removeProject(projectId);
    await client.close();
  }
}

function chatScreen(page: Page, chatId: string) {
  return page.getByTestId(`chat-screen-${chatId}`);
}

// The header sits beside, not inside, the Messages screen; retained routes stay mounted hidden.
function headerButton(page: Page, name: string) {
  return page.getByRole("button", { name, exact: true }).filter({ visible: true });
}

function filesButton(page: Page, _chatId: string) {
  return headerButton(page, "Files and changes");
}

function visibleExplorer(page: Page) {
  return page.getByTestId("workspace-explorer-sidebar").filter({ visible: true });
}

function explorerTab(explorer: ReturnType<typeof visibleExplorer>, name: string) {
  return explorer.getByRole("button", { name, exact: true });
}

async function openChat(page: Page, chatId: string) {
  await page.goto(`/h/${getServerId()}/chat/${chatId}`);
  await expect(chatScreen(page, chatId).getByRole("textbox")).toBeEditable();
  await expect(filesButton(page, chatId)).toBeEnabled({ timeout: 30_000 });
}

async function expectChatExplorerToggles(page: Page, chatId: string, isGit: boolean) {
  await filesButton(page, chatId).click();
  const explorer = visibleExplorer(page);
  await expect(explorer).toBeVisible();
  await expect(explorerTab(explorer, "Browse workspace files")).toBeVisible();
  await expect(explorerTab(explorer, "Working tree diff")).toHaveCount(isGit ? 1 : 0);
  await expect(
    page.getByTestId("file-explorer-tree-scroll").filter({ visible: true }),
  ).toContainText("README.md");
  // The conversation stays on screen beside the pane.
  await expect(chatScreen(page, chatId).getByRole("textbox")).toBeVisible();
  await filesButton(page, chatId).click();
  await expect(visibleExplorer(page)).toHaveCount(0);
}

test.describe("Bot chat Files and changes", () => {
  test("desktop opens and closes the Explorer pane, and keeps working across Cowork", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const repo = await createTempGitRepo("bot-chat-explorer-");
    try {
      await withDirectBotChat(repo, async (chatId) => {
        await openChat(page, chatId);
        await expectChatExplorerToggles(page, chatId, true);

        // Leave the pane open, start the bot's session and move into its Cowork workspace.
        await filesButton(page, chatId).click();
        await expect(visibleExplorer(page)).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath("chat-explorer-open.png"),
          animations: "disabled",
        });
        const composer = chatScreen(page, chatId).getByRole("textbox");
        await composer.fill("Start the fixture session");
        await composer.press("Enter");
        await expect(chatScreen(page, chatId).getByText("Fixture ready")).toBeVisible({
          timeout: 30_000,
        });
        await headerButton(page, "Open in cowork").click();
        await expect(headerButton(page, "Back to chat")).toBeVisible({ timeout: 30_000 });
        const coworkExplorer = await ensureExplorerSidebar(page);
        await expect(explorerTab(coworkExplorer, "Browse workspace files")).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath("cowork-explorer-open.png"),
          animations: "disabled",
        });
        const coworkToggle = page.getByTestId("workspace-explorer-toggle").filter({
          visible: true,
        });
        await coworkToggle.click();
        await expect(visibleExplorer(page)).toHaveCount(0);
        await coworkToggle.click();
        await expect(visibleExplorer(page)).toBeVisible();

        await headerButton(page, "Back to chat").click();
        await expect(chatScreen(page, chatId).getByRole("textbox")).toBeVisible();
        await expect(visibleExplorer(page)).toBeVisible();
        await filesButton(page, chatId).click();
        await expect(visibleExplorer(page)).toHaveCount(0);
        await expectChatExplorerToggles(page, chatId, true);
      });
    } finally {
      await repo.cleanup();
    }
  });

  test("desktop shows Files only for a folder that is not a Git checkout", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const folder = await createTempDirectory("bot-chat-explorer-plain-");
    try {
      await writeFile(`${folder.path}/README.md`, "# Plain folder\n");
      await withDirectBotChat(folder, async (chatId) => {
        await openChat(page, chatId);
        await expectChatExplorerToggles(page, chatId, false);
      });
    } finally {
      await folder.cleanup();
    }
  });

  test("phone opens the Files overlay from the same button", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const repo = await createTempGitRepo("bot-chat-explorer-phone-");
    try {
      await withDirectBotChat(repo, async (chatId) => {
        await openChat(page, chatId);
        await filesButton(page, chatId).click();
        await expect(
          page.getByTestId("explorer-tab-files").filter({ visible: true }),
        ).toBeVisible();
        await page.getByTestId("explorer-close").filter({ visible: true }).click();
        await expect(page.getByTestId("explorer-tab-files").filter({ visible: true })).toHaveCount(
          0,
        );
      });
    } finally {
      await repo.cleanup();
    }
  });
});
