import { writeFile } from "node:fs/promises";
import type { Page, TestInfo } from "@playwright/test";
import { loadSessionMessageReaders } from "./new-workspace";

export async function recordTimelinePagination(page: Page) {
  const wire: unknown[] = [];
  const frames = await loadSessionMessageReaders();
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const message = frames.client(payload);
      if (message?.type === "fetch_agent_timeline_request") {
        wire.push({ at: Date.now(), direction: "sent", message });
      }
    });
    socket.on("framereceived", ({ payload }) => {
      const message = frames.server(payload);
      if (message?.type !== "fetch_agent_timeline_response") return;
      const { requestId, direction, startCursor, endCursor, hasOlder, hasNewer, error } =
        message.payload;
      wire.push({
        at: Date.now(),
        direction: "received",
        response: { requestId, direction, startCursor, endCursor, hasOlder, hasNewer, error },
      });
    });
  });
  await page.addInitScript(() => {
    const records: unknown[] = [];
    Object.assign(window, { __timelinePaginationDiagnostic: records });
    const record = (event: Event) => {
      const scroll = document.querySelector('[data-testid="agent-chat-scroll"]');
      if (!(scroll instanceof HTMLElement) || records.length >= 1_024) return;
      records.push({
        at: Date.now(),
        event: event.type,
        top: scroll.scrollTop,
        height: scroll.scrollHeight,
        spinner: Boolean(document.querySelector('[data-testid="load-older-history-spinner"]')),
      });
    };
    document.addEventListener("scroll", record, true);
    document.addEventListener("wheel", record, true);
  });
  return async (testInfo: TestInfo) => {
    // Save before fixture cleanup replaces the failed conversation with an unavailable page.
    const geometry = await page.evaluate(
      () =>
        (window as unknown as { __timelinePaginationDiagnostic: unknown })
          .__timelinePaginationDiagnostic,
    );
    const path = testInfo.outputPath("timeline-pagination-diagnostic.json");
    await writeFile(path, JSON.stringify({ wire, geometry }, null, 2));
    await testInfo.attach("timeline-pagination-diagnostic", {
      path,
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath("timeline-before-cleanup.png") });
  };
}
