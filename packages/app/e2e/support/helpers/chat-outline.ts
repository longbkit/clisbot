import { expect, type Locator, type Page } from "@playwright/test";
import { openSettings } from "./app";
import { openSettingsSection } from "./settings";
import { runWorkspaceActionFromCommandCenter } from "./command-center-workspace-actions";
import { seedMockAgentWorkspace, type MockAgentWorkspace } from "./mock-agent";
import { loadSessionMessageReaders } from "./new-workspace";

export async function withStreamingMarkdownOutline(
  run: (agent: MockAgentWorkspace) => Promise<void>,
): Promise<void> {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "chat-outline-markdown-",
    title: "Streaming Markdown outline",
    featureValues: {
      mockStreamingAssistantResponse: Array.from(
        { length: 60 },
        (_, index) => `Paragraph ${index + 1}.`,
      ).join("\n\n"),
      // Leave time to inspect a live turn even on a busy browser worker.
      mockStreamingAssistantIntervalMs: 160,
    },
  });
  try {
    await run(agent);
  } finally {
    await agent.cleanup();
  }
}

export async function expectReadingStreamedMarkdown(page: Page, prompt: string): Promise<void> {
  await expect(page.getByText("Paragraph 30.", { exact: true }).last()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate((expectedPrompt) => {
        const timeline = Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid="agent-chat-scroll"]'),
        ).find((element) => element.getClientRects().length > 0);
        const promptRow = Array.from(
          timeline?.querySelectorAll<HTMLElement>('[data-testid="user-message"]') ?? [],
        ).find((element) => element.textContent?.includes(expectedPrompt));
        return timeline && promptRow
          ? promptRow.getBoundingClientRect().bottom - timeline.getBoundingClientRect().top
          : Number.POSITIVE_INFINITY;
      }, prompt),
    )
    .toBeLessThan(0);
  await expect(page.getByRole("button", { name: "Stop agent", exact: true })).toBeVisible();
}

export function chatOutlineRail(page: Page): Locator {
  return page.getByTestId("chat-outline-rail");
}

function chatOutlinePrompt(page: Page, position: number): Locator {
  return chatOutlineRail(page)
    .getByRole("tab")
    .nth(position - 1);
}

export async function expectChatOutlinePrompts(page: Page, count: number): Promise<void> {
  await expect(chatOutlineRail(page)).toBeVisible();
  await expect(chatOutlineRail(page).getByRole("tab")).toHaveCount(count);
}

export async function expectNoChatOutline(page: Page): Promise<void> {
  await expect(chatOutlineRail(page)).toBeHidden();
}

export async function hoverChatOutlinePrompt(page: Page, position: number): Promise<void> {
  await chatOutlinePrompt(page, position).hover();
}

/**
 * The trailing edge of a prompt's row, far from its left-anchored pill. Acquiring a prompt
 * there is what makes the rail usable when a long conversation squeezes the pills thin.
 */
export async function pointAtChatOutlineRowEdge(page: Page, position: number): Promise<void> {
  const row = await promptRowBox(page, position);
  await page.mouse.move(row.x + row.width - 1, row.y + row.height / 2);
}

export async function clickChatOutlineRowEdge(page: Page, position: number): Promise<void> {
  await pointAtChatOutlineRowEdge(page, position);
  await page.mouse.down();
  await page.mouse.up();
}

export async function splitCurrentPanelRight(page: Page): Promise<void> {
  await runWorkspaceActionFromCommandCenter(page, "Split pane right");
}

export async function disableChatOutlineFromAppearance(page: Page): Promise<void> {
  const timelineUrl = page.url();
  await openSettings(page);
  await openSettingsSection(page, "chat");
  await page.getByRole("switch", { name: "Chat outline" }).click();
  await page.goto(timelineUrl);
}

/** Parks the pointer in the middle of the transcript, clear of the rail. */
export async function movePointerOffChatOutline(page: Page): Promise<void> {
  const timeline = page.locator('[data-testid="agent-chat-scroll"]:visible').first();
  const box = await requireBoundingBox(timeline);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

export async function focusChatOutlinePrompt(page: Page, position: number): Promise<void> {
  await chatOutlinePrompt(page, position).focus();
}

export async function pressEnterOnFocusedPrompt(page: Page): Promise<void> {
  await page.keyboard.press("Enter");
}

export async function expectChatOutlinePreview(page: Page, preview: string): Promise<void> {
  await expect(page.getByTestId("chat-outline-preview")).toHaveText(preview);
}

export async function expectNoChatOutlinePreview(page: Page): Promise<void> {
  await expect(page.getByTestId("chat-outline-preview")).toHaveCount(0);
}

export async function expectNoChatOutlinePreviewWhileCrossingToSidebar(page: Page): Promise<void> {
  const railBox = await requireBoundingBox(chatOutlineRail(page));
  const clockStart = Date.now();
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(clockStart + 60_000);
  await page.mouse.move(railBox.x + railBox.width + 2, railBox.y + railBox.height / 2);
  await page.evaluate(() => {
    document.body.dataset.chatOutlinePreviewObserved = String(
      document.querySelector('[data-testid="chat-outline-preview"]') !== null,
    );
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-testid="chat-outline-preview"]')) {
        document.body.dataset.chatOutlinePreviewObserved = "true";
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    Object.assign(window, { __chatOutlinePreviewObserver: observer });
  });

  // Keep the transit slower than the activation delay at every point while making the whole
  // crossing longer than it. Horizontal motion must keep postponing activation until leave
  // cancels the final pending timer.
  const transitSteps = 6;
  for (let step = 0; step < transitSteps; step += 1) {
    await page.mouse.move(
      railBox.x + railBox.width - 1 - (step * railBox.width) / transitSteps,
      railBox.y + railBox.height / 2,
    );
    await page.clock.runFor(100);
  }
  await page.mouse.move(railBox.x - 2, railBox.y + railBox.height / 2);
  await page.clock.runFor(200);

  const previewAppeared = await page.evaluate(() => {
    const observer = Reflect.get(window, "__chatOutlinePreviewObserver") as
      | MutationObserver
      | undefined;
    observer?.disconnect();
    Reflect.deleteProperty(window, "__chatOutlinePreviewObserver");
    const observed = document.body.dataset.chatOutlinePreviewObserved === "true";
    delete document.body.dataset.chatOutlinePreviewObserved;
    return observed;
  });
  expect(previewAppeared).toBe(false);
}

export async function expectChatOutlinePromptToRemainBare(
  page: Page,
  position: number,
): Promise<void> {
  await expect(chatOutlinePrompt(page, position)).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
}

/** Exactly one prompt is marked, without saying which — the reader always has a "you are here". */
export async function expectOneActiveChatOutlinePrompt(page: Page): Promise<void> {
  await expect(chatOutlineRail(page).getByRole("tab", { selected: true })).toHaveCount(1);
}

export async function expectActiveChatOutlinePrompt(page: Page, position: number): Promise<void> {
  await expect(chatOutlineRail(page).getByRole("tab", { selected: true })).toHaveAccessibleName(
    new RegExp(`^${position} of `),
  );
}

export async function expectActiveChatOutlinePromptMovedFrom(
  page: Page,
  position: number,
): Promise<void> {
  const activePrompt = chatOutlineRail(page).getByRole("tab", { selected: true });
  await expect(activePrompt).toHaveCount(1);
  await expect(activePrompt).not.toHaveAccessibleName(new RegExp(`^${position} of `));
}

export async function expectLiveTurnPromptAboveFoldAndActive(
  page: Page,
  prompt: string,
  position: number,
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ prompt: expectedPrompt, position: expectedPosition }) => {
            const timeline = Array.from(
              document.querySelectorAll<HTMLElement>('[data-testid="agent-chat-scroll"]'),
            ).find((element) => element.getClientRects().length > 0);
            const promptRow = Array.from(
              timeline?.querySelectorAll<HTMLElement>('[data-testid="user-message"]') ?? [],
            ).find((element) => element.textContent?.includes(expectedPrompt));
            const activeTick = document.querySelector(
              '[data-testid="chat-outline-rail"] [role="tab"][aria-selected="true"]',
            );
            // Sample one rendered frame. Locator.boundingBox waits for a row that
            // virtualization may already have unmounted, blocking the entire poll.
            return Boolean(
              timeline &&
              promptRow &&
              promptRow.getBoundingClientRect().bottom < timeline.getBoundingClientRect().top &&
              activeTick?.getAttribute("aria-label")?.startsWith(`${expectedPosition} of `),
            );
          },
          { prompt, position },
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
}

async function promptRowBox(
  page: Page,
  position: number,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return requireBoundingBox(chatOutlinePrompt(page, position));
}

async function requireBoundingBox(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Expected the chat outline element to have a layout box");
  }
  return box;
}

export async function observePromptIndexRequests(page: Page) {
  const frames = await loadSessionMessageReaders();
  const agentIds: string[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const request = frames.client(payload);
      if (request?.type === "agent.timeline.list_prompts.request") {
        agentIds.push(request.agentId);
      }
    });
  });
  return {
    async waitForRequestFor(agentId: string) {
      await expect.poll(() => agentIds).toContain(agentId);
    },
    requestedAgentIds: () => [...new Set(agentIds)],
  };
}
