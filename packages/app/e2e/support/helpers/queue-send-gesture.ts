import { writeFile } from "node:fs/promises";
import { test, expect, type Locator, type Page } from "@playwright/test";

let gestureSequence = 0;

/** Real held Chromium touch gesture in phone-sized browser; native touch remains a separate proof. */
export async function longPressSend(
  page: Page,
  scope: Locator,
  expectedAction: "queue" | "steer" = "queue",
) {
  const prefix = `held-send-${++gestureSequence}`;
  const info = test.info();
  const button = scope.getByTestId("composer-send-button").first();
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("data-send-actions", "longpress");
  await button.scrollIntoViewIfNeeded();
  await expect
    .poll(
      () =>
        button.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return hit === node || (hit !== null && node.contains(hit));
        }),
      { message: "Send must own its touch point after the attachment sheet closes" },
    )
    .toBe(true);
  const box = await button.boundingBox();
  if (!box) throw new Error("Send target is not visible");
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const hit = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    const target = element?.closest('[role="button"],button');
    document.documentElement.setAttribute("data-queue-gesture-events", "[]");
    for (const type of [
      "touchstart",
      "touchend",
      "touchcancel",
      "pointerdown",
      "pointerup",
      "contextmenu",
      "click",
    ])
      document.addEventListener(
        type,
        (event) => {
          const events = JSON.parse(
            document.documentElement.getAttribute("data-queue-gesture-events") ?? "[]",
          );
          const node =
            event.target instanceof Element ? event.target.closest('[role="button"],button') : null;
          events.push({
            type,
            at: performance.now(),
            target: node?.getAttribute("data-testid"),
            menu: node?.getAttribute("data-send-actions"),
          });
          document.documentElement.setAttribute(
            "data-queue-gesture-events",
            JSON.stringify(events),
          );
        },
        { capture: true },
      );
    return {
      width: innerWidth,
      height: innerHeight,
      x,
      y,
      tag: target?.tagName,
      element: element?.tagName,
      target: target?.getAttribute("data-testid"),
      menu: target?.getAttribute("data-send-actions"),
    };
  }, point);
  const hitPath = info.outputPath(`${prefix}-hit.json`);
  await writeFile(hitPath, JSON.stringify(hit, null, 2));
  await info.attach("held-send-hit-target", { path: hitPath, contentType: "application/json" });
  await page.screenshot({ path: info.outputPath(`${prefix}-hit.png`), fullPage: false });
  expect(hit.target).toBe("composer-send-button");
  expect(hit.menu).toBe("longpress");
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
    try {
      await page.waitForTimeout(650);
    } finally {
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
  } finally {
    await session.detach();
  }
  const eventsPath = info.outputPath(`${prefix}-events.json`);
  await writeFile(
    eventsPath,
    (await page.locator("html").getAttribute("data-queue-gesture-events")) ?? "[]",
  );
  await info.attach("held-send-dom-events", { path: eventsPath, contentType: "application/json" });
  await page.screenshot({ path: info.outputPath(`${prefix}-release.png`), fullPage: false });
  await expect(page.getByTestId(`composer-send-once-${expectedAction}`)).toBeVisible();
}
