import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { BrowserKeyboardPolicy } from "./features/browser-keyboard/index.js";
import type { DesktopWindowChromeMode } from "./window/chrome.js";

// This preload runs in Electron's sandbox and is tsc-compiled (not bundled), so it MUST
// NOT emit any runtime module load other than "electron" — a require() of a local or
// third-party module throws and aborts the preload before exposeInMainWorld runs, leaving
// window.clisbotDesktop undefined (the 0.1.108 regression, #2103). Keep this literal in sync
// with CLISBOT_BROWSER_PROFILE_PARTITION in features/browser-profile.ts; preload-sandbox.test.ts
// guards both the no-local-import rule and this drift. Type-only imports are fine (erased at emit).
const CLISBOT_BROWSER_PROFILE_PARTITION = "persist:clisbot-browser";

type EventHandler = (payload: unknown) => void;

function readWindowChromeMode(): DesktopWindowChromeMode {
  const prefix = "--clisbot-window-chrome-mode=";
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (value === "native-mac" || value === "custom-windows" || value === "custom-linux") {
    return value;
  }
  // COMPAT(windowChromeMode): added in v0.5.3; remove after 2026-11-25.
  if (process.platform === "darwin") return "native-mac";
  return process.platform === "linux" ? "custom-linux" : "custom-windows";
}

interface AttachedBrowserRegistration {
  browserId: string;
  workspaceId: string;
  webContentsId: number;
}

contextBridge.exposeInMainWorld("clisbotDesktop", {
  platform: process.platform,
  windowChromeMode: readWindowChromeMode(),
  invoke: (command: string, args?: Record<string, unknown>) =>
    ipcRenderer.invoke("clisbot:invoke", command, args),
  getPendingOpenProject: () =>
    ipcRenderer.invoke("clisbot:get-pending-open-project") as Promise<string | null>,
  agentNavigation: {
    ready: () =>
      ipcRenderer.invoke("clisbot:agent-navigation:ready") as Promise<{
        serverId: string;
        agentId: string;
      } | null>,
  },
  events: {
    on: (event: string, handler: EventHandler): Promise<() => void> => {
      const listener = (_ipcEvent: Electron.IpcRendererEvent, payload: unknown) => {
        handler(payload);
      };
      ipcRenderer.on(`clisbot:event:${event}`, listener);
      return Promise.resolve(() => {
        ipcRenderer.removeListener(`clisbot:event:${event}`, listener);
      });
    },
  },
  window: {
    openNew: (options?: { pendingOpenProjectPath?: string | null }) =>
      ipcRenderer.invoke("clisbot:window:openNew", options),
    getCurrentWindow: () => ({
      minimize: () => ipcRenderer.invoke("clisbot:window:minimize"),
      close: () => ipcRenderer.invoke("clisbot:window:close"),
      toggleMaximize: () => ipcRenderer.invoke("clisbot:window:toggleMaximize"),
      isMaximized: () => ipcRenderer.invoke("clisbot:window:isMaximized"),
      setFullscreen: (fullscreen: boolean) =>
        ipcRenderer.invoke("clisbot:window:setFullscreen", fullscreen),
      isFullscreen: () => ipcRenderer.invoke("clisbot:window:isFullscreen"),
      updateChrome: (update: { backgroundColor?: string; trafficLightOffsetY?: number }) =>
        ipcRenderer.invoke("clisbot:window:updateChrome", update),
      onResized: (handler: EventHandler): (() => void) => {
        const listener = (_ipcEvent: Electron.IpcRendererEvent, payload: unknown) => {
          handler(payload);
        };
        ipcRenderer.on("clisbot:window:resized", listener);
        return () => {
          ipcRenderer.removeListener("clisbot:window:resized", listener);
        };
      },
      setBadgeCount: (count?: number) => ipcRenderer.invoke("clisbot:window:setBadgeCount", count),
    }),
  },
  dialog: {
    ask: (message: string, options?: Record<string, unknown>) =>
      ipcRenderer.invoke("clisbot:dialog:ask", message, options),
    askWithCheckbox: (message: string, options: Record<string, unknown>) =>
      ipcRenderer.invoke("clisbot:dialog:askWithCheckbox", message, options),
    open: (options?: Record<string, unknown>) => ipcRenderer.invoke("clisbot:dialog:open", options),
  },
  notification: {
    isSupported: () => ipcRenderer.invoke("clisbot:notification:isSupported"),
    sendNotification: (payload: { title: string; body?: string; data?: Record<string, unknown> }) =>
      ipcRenderer.invoke("clisbot:notification:send", payload),
  },
  opener: {
    openUrl: (url: string) => ipcRenderer.invoke("clisbot:opener:openUrl", url),
  },
  hub: {
    signIn: (input: { origin: string; invitationId?: string }) =>
      ipcRenderer.invoke("clisbot:hub:sign-in", input),
    signOut: (input: { origin: string }) => ipcRenderer.invoke("clisbot:hub:sign-out", input),
    request: (input: {
      origin: string;
      path: string;
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      headers?: Record<string, string>;
      body?: string;
    }) => ipcRenderer.invoke("clisbot:hub:request", input),
  },
  editor: {
    listTargets: () => ipcRenderer.invoke("clisbot:editor:listTargets"),
    openTarget: (input: {
      editorId: string;
      workspacePath: string;
      filePath?: string;
      line?: number;
      column?: number;
    }) => ipcRenderer.invoke("clisbot:editor:openTarget", input),
  },
  webUtils: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  menu: {
    showContextMenu: (input?: Record<string, unknown>) =>
      ipcRenderer.invoke("clisbot:menu:showContextMenu", input),
    setCapturingShortcut: (capturing: boolean) =>
      ipcRenderer.invoke("clisbot:menu:set-capturing-shortcut", capturing),
  },
  browser: {
    setShortcutPolicy: (input: BrowserKeyboardPolicy) =>
      ipcRenderer.invoke("clisbot:browser:set-shortcut-policy", input),
    profilePartition: CLISBOT_BROWSER_PROFILE_PARTITION,
    registerAttachedBrowser: (input: AttachedBrowserRegistration) =>
      ipcRenderer.invoke("clisbot:browser:register-attached", input),
    unregisterWorkspaceBrowser: (browserId: string) =>
      ipcRenderer.invoke("clisbot:browser:unregister-workspace-browser", browserId),
    setWorkspaceActiveBrowser: (input: { workspaceId: string; browserId: string | null }) =>
      ipcRenderer.invoke("clisbot:browser:set-workspace-active-browser", input),
    focus: (browserId: string) => ipcRenderer.invoke("clisbot:browser:focus", browserId),
    openDevTools: (browserId: string) =>
      ipcRenderer.invoke("clisbot:browser:open-devtools", browserId),
    clearProfile: (legacyBrowserIds: string[]) =>
      ipcRenderer.invoke("clisbot:browser:clear-profile", legacyBrowserIds),
    executeAutomationCommand: (request: Record<string, unknown>) =>
      ipcRenderer.invoke("clisbot:browser:execute-automation-command", request),
    captureElement: (
      browserId: string,
      rect: { x: number; y: number; width: number; height: number },
    ) => ipcRenderer.invoke("clisbot:browser:capture-element", browserId, rect),
    copyElement: (payload: { text?: string; imageDataUrl?: string }) =>
      ipcRenderer.invoke("clisbot:browser:copy-element", payload),
  },
});
