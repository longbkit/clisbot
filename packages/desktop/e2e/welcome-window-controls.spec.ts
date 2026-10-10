import { test, expect } from "@playwright/test";

for (const platform of ["linux", "win32"] as const) {
  test(`Welcome actions remain clickable beside ${platform} window controls`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.addInitScript((targetPlatform) => {
      window.clisbotDesktop = {
        platform: targetPlatform,
        windowChromeMode: targetPlatform === "linux" ? "custom-linux" : "custom-windows",
        invoke: async (command: string) => {
          if (command === "get_desktop_settings") {
            return {
              releaseChannel: "stable",
              daemon: { manageBuiltInDaemon: false, keepRunningAfterQuit: false },
            };
          }
          return null;
        },
        events: { on: async () => () => undefined },
        window: {
          getCurrentWindow: () => ({
            isFullscreen: async () => false,
            isMaximized: async () => false,
            onResized: async () => () => undefined,
            updateChrome: async () => undefined,
          }),
        },
      };
    }, platform);
    await page.goto("/welcome?stay=1");
    const controls = page.getByTestId("desktop-window-controls");
    await expect(controls).toBeVisible();
    const settings = page.getByTestId("welcome-open-settings");
    const close = page.getByTestId("welcome-close");
    await expect(settings).toBeVisible();
    for (const action of [settings, close]) {
      const actionBox = await action.boundingBox();
      const controlsBox = await controls.boundingBox();
      expect(actionBox).not.toBeNull();
      expect(controlsBox).not.toBeNull();
      expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(controlsBox!.x);
    }
    await settings.click();
    await expect(page).toHaveURL(/\/settings(?:[/?]|$)/);
  });
}
