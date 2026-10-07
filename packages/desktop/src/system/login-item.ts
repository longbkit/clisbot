export interface LoginItemSettingsWriter {
  setLoginItemSettings(settings: { openAtLogin: boolean }): void;
}

export function configureMacOSLoginItem(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  app: LoginItemSettingsWriter;
}): void {
  if (input.platform !== "darwin" || !input.isPackaged) {
    return;
  }

  input.app.setLoginItemSettings({ openAtLogin: true });
}
