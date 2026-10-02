export const ANALYTICS_SCREENS = [
  "home",
  "welcome",
  "settings",
  "new_agent",
  "agent",
  "workspace",
  "project",
  "bot",
  "chat",
  "automations",
  "schedules",
  "cli_login",
  "other",
] as const;
export type AnalyticsScreen = (typeof ANALYTICS_SCREENS)[number];
export type AnalyticsEvent =
  | { name: "app_open" }
  | { name: "screen_view"; screen: AnalyticsScreen }
  | { name: "engagement"; milliseconds: number };

// Expo's route templates, never usePathname(), route params or visible titles.
export function analyticsScreen(segments: readonly string[]): AnalyticsScreen {
  if (segments.includes("settings")) return "settings";
  for (const screen of ["welcome", "automations", "schedules"] as const) {
    if (segments.includes(screen)) return screen;
  }
  if (segments.includes("cli-login")) return "cli_login";
  if (segments.includes("new")) return "new_agent";
  for (const screen of ["agent", "workspace", "project", "bot", "chat"] as const) {
    if (segments.includes(screen)) return screen;
  }
  return segments.every((s) => s.startsWith("(")) ? "home" : "other";
}

export interface AnalyticsAdapter {
  setEnabled(enabled: boolean): Promise<void>;
  send(event: AnalyticsEvent): Promise<void>;
}
export interface ConsentStorage {
  read(): Promise<boolean>;
  write(enabled: boolean): Promise<void>;
}
export function analyticsPreference(saved: string | null): boolean {
  // New installs default on; an explicit opt-out always wins.
  return saved === null || saved === "accepted";
}
export type AnalyticsState = Readonly<{
  ready: boolean;
  enabled: boolean;
  pending: boolean;
  error: "storage" | "unavailable" | null;
}>;

/** Local preference owns collection. No queue/replay while disabled or loading. */
export class ProductAnalytics {
  private state: AnalyticsState = {
    ready: false,
    enabled: false,
    pending: false,
    error: null,
  };
  private listeners = new Set<() => void>();
  private initialization?: Promise<void>;
  private revision = 0;
  private changes: Promise<void> = Promise.resolve();
  private requestedConsent = false;
  constructor(
    private storage: ConsentStorage,
    private adapter: AnalyticsAdapter,
  ) {}
  getSnapshot = (): AnalyticsState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<AnalyticsState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  initialize(): Promise<void> {
    return (this.initialization ??= (async () => {
      const revision = this.revision;
      try {
        const enabled = await this.storage.read();
        if (revision !== this.revision) return;
        await this.adapter.setEnabled(enabled);
        if (revision === this.revision) this.update({ enabled });
      } catch {
        this.update({ enabled: false, error: "unavailable" });
        await this.adapter.setEnabled(false).catch(() => {});
      } finally {
        this.update({ ready: true });
      }
    })());
  }
  setEnabled(enabled: boolean): Promise<void> {
    this.requestedConsent = enabled;
    ++this.revision;
    // Revoke immediately, even while storage or an earlier enable is pending.
    this.update({ enabled: false, pending: true, error: null });
    const revision = this.revision;
    const change = async () => {
      await this.initialize();
      await this.adapter.setEnabled(false).catch(() => {});
      try {
        await this.storage.write(enabled);
      } catch {
        if (revision === this.revision) this.update({ pending: false, error: "storage" });
        return;
      }
      if (revision !== this.revision) return;
      try {
        await this.adapter.setEnabled(enabled);
        if (revision === this.revision) this.update({ enabled, pending: false });
        else await this.adapter.setEnabled(false);
      } catch {
        await this.adapter.setEnabled(false).catch(() => {});
        if (revision === this.revision)
          this.update({ enabled: false, pending: false, error: "unavailable" });
      }
    };
    this.changes = this.changes.then(change, change);
    return this.changes;
  }
  track(event: AnalyticsEvent): void {
    if (!this.state.ready || !this.state.enabled || this.state.pending) return;
    void this.adapter.send(event).catch(() => {});
  }
  retrySavingConsent(): Promise<void> {
    return this.setEnabled(this.requestedConsent);
  }
}
