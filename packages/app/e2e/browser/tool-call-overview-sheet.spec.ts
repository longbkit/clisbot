import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { openSettings } from "../support/helpers/app";
import { openSettingsSection } from "../support/helpers/settings";
import { expectComposerVisible } from "../support/helpers/composer";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

type WebSocketMessage = string | Buffer;

const COMPACT_VIEWPORT = { width: 390, height: 520 };

function parseSessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const envelope = JSON.parse(raw) as { type?: unknown; message?: unknown };
    return envelope.type === "session" && envelope.message && typeof envelope.message === "object"
      ? (envelope.message as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getToolCallStatus(
  message: WebSocketMessage,
  agentId: string,
): { callId: string; status: string } | null {
  const sessionMessage = parseSessionMessage(message);
  if (sessionMessage?.type !== "agent_stream") {
    return null;
  }
  const payload = sessionMessage.payload as Record<string, unknown> | undefined;
  if (payload?.agentId !== agentId) {
    return null;
  }
  const event = payload.event as Record<string, unknown> | undefined;
  const item = event?.item as Record<string, unknown> | undefined;
  return event?.type === "timeline" &&
    item?.type === "tool_call" &&
    typeof item.callId === "string" &&
    typeof item.status === "string"
    ? { callId: item.callId, status: item.status }
    : null;
}

function cloneToolCallWithId(
  message: WebSocketMessage,
  callId: string,
  sequenceOffset: number,
): string {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  const envelope = JSON.parse(raw) as {
    message?: { payload?: { seq?: number; event?: { item?: { callId?: string } } } };
  };
  const payload = envelope.message?.payload;
  const item = payload?.event?.item;
  if (!payload || !item?.callId || typeof payload.seq !== "number") {
    throw new Error("Expected a tool-call session message");
  }
  item.callId = callId;
  payload.seq += sequenceOffset;
  return JSON.stringify(envelope);
}

function shiftTimelineSequence(
  message: WebSocketMessage,
  sequenceOffset: number,
): WebSocketMessage {
  if (sequenceOffset === 0) {
    return message;
  }
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const envelope = JSON.parse(raw) as { message?: { payload?: { seq?: number } } };
    const payload = envelope.message?.payload;
    if (typeof payload?.seq !== "number") {
      return message;
    }
    payload.seq += sequenceOffset;
    return JSON.stringify(envelope);
  } catch {
    return message;
  }
}

async function holdStreamAfterFirstCompletedToolCall(page: Page, agentId: string) {
  let firstCallId: string | null = null;
  let firstCompletedMessage: WebSocketMessage | null = null;
  let isHolding = false;
  let sequenceOffset = 0;
  const heldMessages: WebSocketMessage[] = [];
  let sendToPage: ((message: WebSocketMessage) => void) | null = null;
  let resolveFirstCompleted!: () => void;
  const firstCompleted = new Promise<void>((resolve) => {
    resolveFirstCompleted = resolve;
  });

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    sendToPage = (message) => ws.send(message);
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (isHolding) {
        heldMessages.push(message);
        return;
      }

      ws.send(shiftTimelineSequence(message, sequenceOffset));
      const toolCall = getToolCallStatus(message, agentId);
      firstCallId ??= toolCall?.callId ?? null;
      if (toolCall?.callId === firstCallId && toolCall.status === "completed") {
        firstCompletedMessage = message;
        isHolding = true;
        resolveFirstCompleted();
      }
    });
  });

  return {
    waitForFirstCompleted: () => firstCompleted,
    injectToolCall(callId: string, command: string, status: "running" | "failed" | "completed") {
      if (!firstCompletedMessage || !sendToPage) throw new Error("First call must have completed");
      const envelope = JSON.parse(
        cloneToolCallWithId(firstCompletedMessage, callId, ++sequenceOffset),
      );
      const item = envelope.message.payload.event.item;
      item.name = "bash";
      item.status = status;
      item.error = status === "failed" ? "QA command failed: exit 1" : null;
      item.detail = {
        type: "shell",
        command,
        output: status === "running" ? undefined : "Isolated QA output",
        exitCode: status === "failed" ? 1 : 0,
      };
      sendToPage(JSON.stringify(envelope));
    },
    release(extraCompletedCalls = 0) {
      isHolding = false;
      if (extraCompletedCalls > 0 && (!firstCallId || !firstCompletedMessage)) {
        throw new Error("Expected the first completed tool call before release");
      }
      for (let index = 0; index < extraCompletedCalls; index += 1) {
        sendToPage?.(
          cloneToolCallWithId(
            firstCompletedMessage as WebSocketMessage,
            `${firstCallId}:${index}`,
            sequenceOffset + index + 1,
          ),
        );
      }
      sequenceOffset += extraCompletedCalls;
      for (const message of heldMessages.splice(0)) {
        sendToPage?.(shiftTimelineSequence(message, sequenceOffset));
      }
    },
  };
}

async function configureOverviewToolCalls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "@clisbot:app-settings",
      JSON.stringify({ toolCallDetailLevel: "overview" }),
    );
    localStorage.setItem(
      "@clisbot:settings-migrations",
      JSON.stringify({ applied: ["summary-with-latest-call-default"] }),
    );
  });
}

async function createOverviewAgent(page: Page, title: string) {
  await configureOverviewToolCalls(page);
  return seedMockAgentWorkspace({
    repoPrefix: "tool-call-overview-sheet-",
    title,
    model: "ten-second-stream",
  });
}

async function openOverviewAgent(
  page: Page,
  agent: Awaited<ReturnType<typeof seedMockAgentWorkspace>>,
): Promise<void> {
  await openAgentRoute(page, {
    workspaceId: agent.workspaceId,
    agentId: agent.agentId,
  });
  await expectComposerVisible(page);
}

function hasScrolledToLatest(root: HTMLElement): boolean {
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if (node.scrollHeight <= node.clientHeight) {
      continue;
    }
    const maximumScrollTop = node.scrollHeight - node.clientHeight;
    return maximumScrollTop > 0 && Math.abs(node.scrollTop - maximumScrollTop) <= 1;
  }
  return false;
}

function readScrollMetrics(root: HTMLElement) {
  const badgeElements = root.querySelectorAll<HTMLElement>("[data-testid=tool-call-badge]");
  const latestBadge = badgeElements.item(badgeElements.length - 1);
  const scrollables = [];
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if (node.scrollHeight <= node.clientHeight) {
      continue;
    }
    scrollables.push({
      className: node.className,
      clientHeight: node.clientHeight,
      rect: node.getBoundingClientRect().toJSON(),
      scrollHeight: node.scrollHeight,
      scrollTop: node.scrollTop,
      tagName: node.tagName,
    });
  }
  return {
    latestBadgeRect: latestBadge?.getBoundingClientRect().toJSON(),
    rootRect: root.getBoundingClientRect().toJSON(),
    scrollables,
    viewport: { height: window.innerHeight, width: window.innerWidth },
  };
}

test.describe("compact overview tool calls", () => {
  test.use({ viewport: COMPACT_VIEWPORT, hasTouch: true });

  test("keeps a live group sheet current and stacks individual details above it", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const agent = await createOverviewAgent(page, "Compact overview tool calls");

    try {
      const gate = await holdStreamAfterFirstCompletedToolCall(page, agent.agentId);
      await openOverviewAgent(page, agent);
      await agent.client.sendAgentMessage(agent.agentId, "Exercise the overview tool-call sheet.");
      await gate.waitForFirstCompleted();

      const group = page.getByTestId("tool-call-group").first();
      await expect(group).toBeVisible();
      await group.click();

      const sheet = page.getByTestId("tool-call-group-sheet");
      const summary = page.getByTestId("tool-call-group-sheet-summary");
      await expect(sheet).toBeVisible();
      const initialSummary = await summary.innerText();

      gate.release(10);
      const badges = sheet.getByTestId("tool-call-badge");
      await expect.poll(() => badges.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(11);
      await expect(summary).not.toHaveText(initialSummary);
      await expect.poll(() => sheet.evaluate(hasScrolledToLatest)).toBe(true);
      const scrollMetrics = await sheet.evaluate(readScrollMetrics);
      await testInfo.attach("compact-overview-scroll-metrics", {
        body: JSON.stringify(scrollMetrics, null, 2),
        contentType: "application/json",
      });

      await badges.last().click();
      const detailClose = page.getByTestId("tool-call-sheet-close");
      await expect(detailClose).toBeVisible();

      await detailClose.click();
      await expect(detailClose).toBeHidden();
      await expect(sheet).toBeVisible();

      await testInfo.attach("compact-overview-tool-call-group", {
        body: await page.screenshot(),
        contentType: "image/png",
      });

      await page.getByTestId("tool-call-group-sheet-close").click();
      await expect(sheet).toBeHidden();
      await expect(group).toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });
});

test("keeps overview tool calls inline on desktop", async ({ page }) => {
  test.setTimeout(120_000);
  const agent = await createOverviewAgent(page, "Desktop overview tool calls");

  try {
    await openOverviewAgent(page, agent);
    await agent.client.sendAgentMessage(agent.agentId, "Exercise desktop overview tool calls.");
    const group = page.getByTestId("tool-call-group").first();
    await expect(group).toBeVisible();

    await group.click();
    await expect(page.getByTestId("tool-call-group-sheet")).toHaveCount(0);
    await expect(group.getByTestId("tool-call-badge").first()).toBeVisible();
  } finally {
    await agent.cleanup();
  }
});

// Renderer QA with a real isolated daemon and explicitly controlled tool events.
// The transport gate gives each live state a deterministic observation point.
for (const layout of ["desktop", "phone-web"] as const) {
  test.describe(`latest-call ${layout}`, () => {
    test.use({ hasTouch: layout === "phone-web" });
    test(`summary with latest call ${layout}: preview, streaming, history and errors`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      if (layout === "phone-web") await page.setViewportSize({ width: 390, height: 844 });
      const agent = await seedMockAgentWorkspace({
        repoPrefix: "latest-call-qa-",
        title: "Latest call QA",
        model: "ten-second-stream",
      });
      const press = (locator: Locator) =>
        layout === "phone-web" ? locator.tap() : locator.click();
      const command =
        "npm run typecheck --workspace=@clisbot/app -- --pretty false && npm run lint -- packages/app/src/tool-calls/detail-level/latest-call/view.tsx";
      const capture = async (name: string) => {
        const path = testInfo.outputPath(`${layout}-${name}.png`);
        await page.screenshot({ path });
        await testInfo.attach(`${layout}-${name}`, { path, contentType: "image/png" });
      };
      try {
        const gate = await holdStreamAfterFirstCompletedToolCall(page, agent.agentId);
        await openOverviewAgent(page, agent);
        expect(
          await page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("@clisbot:app-settings") ?? "null")
                .toolCallDetailLevel,
          ),
        ).toBe("summary-with-latest-call");
        await agent.client.sendAgentMessage(
          agent.agentId,
          "Exercise latest tool preview and preserve intermediate content.",
        );
        await gate.waitForFirstCompleted();
        const group = page.getByTestId("tool-call-group").first();
        await expect(group).toContainText("1 tool call");
        await expect(group).toContainText("conversation-list.tsx");
        await capture("initial-preview");
        gate.injectToolCall("qa-long-command", command, "running");
        await expect(group).toContainText("2 tool calls");
        await expect(group).toContainText("npm run typecheck");
        await expect(group.getByTestId("tool-call-badge")).toHaveCount(0);
        await expect(group.locator('[style*="clisbot-toolcall-shimmer"]').first()).toBeVisible();
        await capture("live-long-command");
        await press(group.getByRole("button"));
        const history = layout === "desktop" ? group : page.getByTestId("tool-call-group-sheet");
        await expect(history.getByTestId("tool-call-badge")).toHaveCount(2);
        await capture("expanded-history");
        gate.injectToolCall("qa-long-command", command, "failed");
        await expect(group).toContainText("1 failed");
        await expect(history.getByTestId("tool-call-badge")).toHaveCount(2);
        await press(history.getByTestId("tool-call-badge").last().getByRole("button").first());
        await expect(
          page.getByText("QA command failed: exit 1", { exact: true }).first(),
        ).toBeVisible();
        await page
          .getByText("QA command failed: exit 1", { exact: true })
          .first()
          .scrollIntoViewIfNeeded();
        await capture("error-details");
        if (layout === "phone-web") {
          await press(page.getByTestId("tool-call-sheet-close"));
          await expect(page.getByTestId("tool-call-group-sheet")).toBeVisible();
          await press(page.getByTestId("tool-call-group-sheet-close"));
        } else {
          await group.getByRole("button").first().click();
        }
        await expect(group.getByTestId("tool-call-badge")).toHaveCount(0);
        await expect(group.locator('[style*="clisbot-toolcall-shimmer"]')).toHaveCount(0);
        await capture("collapsed-error");
        gate.release();
        await agent.client.waitForAgentUpsert(
          agent.agentId,
          (snapshot) => snapshot.status === "idle",
          30_000,
        );
        // A timed stream can emit additional cycles while the touch interactions run.
        // Preserve the separated runs and check exact grouping against Overview below.
        await expect
          .poll(() => page.getByTestId("tool-call-group").count())
          .toBeGreaterThanOrEqual(2);
        await expect(page.getByTestId("tool-call-group").last()).toContainText(
          "simulate-stream-burst.mjs",
        );
        await expect(
          page.getByTestId("tool-call-group").last().locator('[style*="clisbot-toolcall-shimmer"]'),
        ).toHaveCount(0);
        await capture("settled");
        // Compare the same canonical settled timeline, rather than assuming how many
        // mock-provider cycles fit into its timed stream.
        const showInMode = async (selection: string) => {
          if (layout === "phone-web") await page.setViewportSize({ width: 1280, height: 800 });
          await openSettings(page);
          await openSettingsSection(page, "chat");
          await page.getByRole("button", { name: /^Tool call display:/ }).click();
          await page.getByRole("menuitem", { name: selection, exact: true }).click();
          await openOverviewAgent(page, agent);
          if (layout === "phone-web") await page.setViewportSize({ width: 390, height: 844 });
          await expect(page.getByText(/Let me make a small adjustment/).first()).toBeVisible();
          await page.getByTestId("tool-call-group").last().scrollIntoViewIfNeeded();
        };
        await showInMode("Summary");
        const overviewGroupCount = await page.getByTestId("tool-call-group").count();
        await capture("comparison-overview");
        await showInMode("Summary with latest call");
        await expect(page.getByTestId("tool-call-group")).toHaveCount(overviewGroupCount);
        await capture("comparison-latest-call");
      } finally {
        await agent.cleanup();
      }
    });
  });
}
