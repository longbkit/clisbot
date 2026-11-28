import React from "react";
import { View } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { i18n } from "@/i18n/i18next";
import { DirectoryStatus } from "@/components/directory-status";
import { HostInputQueuePanel } from "@/composer/host-input-queue-panel";
import { LanguageQuickList } from "@/clisbot/language/language-picker";
import { CadencePicker } from "@/clisbot/schedules/cadence-picker";
import { ModelList, ProfileList } from "@/clisbot/composer-picker/model-list";
import { ProviderHeader } from "@/clisbot/composer-picker/provider-header";
import { UndoToast } from "@/clisbot/search-scope/show-in-work";

/**
 * Upstream v0.17.4 dropped Button's `xs`; these Clisbot callers moved to `sm`. At phone widths
 * (320-375pt) each button must stay on its row, keep its label on one line, and be at least the
 * touch `sm` height (32pt, above the old 28pt `xs`).
 */

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ show: () => undefined, copied: () => undefined, error: () => undefined }),
}));
vi.mock("@/contexts/toast-api-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/toast-api-context")>()),
  useToast: () => ({ show: () => undefined, copied: () => undefined, error: () => undefined }),
}));

const noop = () => undefined;

const UNREACHABLE_HEALTH = {
  status: "unavailable",
  message: "Host build-03 is not reachable right now",
  serverId: "build-03",
  recovery: "retry",
  hasAcceptedResult: false,
} as const;
const EMPTY_QUEUE = { items: [] };
const STALE_EDITOR = { stale: true };
const DAILY_CADENCE = { type: "cron", expression: "0 9 * * *", timezone: "UTC" } as const;
const MODEL_LOAD_ERROR = { error: "Could not load models from the provider" };
const NO_HIGHLIGHTS = new Map();
const NO_PROFILES = { rows: [], applyProfile: noop } as never;
const CLAUDE_PROVIDER = { id: "claude", label: "Claude" };
const FAILED_REFRESH = {
  available: true,
  run: async () => undefined,
  isPending: () => false,
  errorFor: () => "Model refresh timed out",
};
const FRAME_STYLE = { width: "100%", padding: 16 } as const;

const subjects: Record<string, { node: () => React.ReactElement; only?: string }> = {
  "directory-status": {
    node: () => <DirectoryStatus label="Workspaces" health={UNREACHABLE_HEALTH} />,
  },
  "host-input-queue-editor": {
    node: () => (
      <HostInputQueuePanel
        view={EMPTY_QUEUE}
        pending={false}
        editor={STALE_EDITOR}
        error={null}
        edit={noop}
        sendNow={noop}
        steer={noop}
        remove={noop}
        save={noop}
        move={noop}
        cancel={noop}
        enqueueNew={noop}
      />
    ),
  },
  "language-quick-list": {
    node: () => <LanguageQuickList language="system" onChange={noop} />,
  },
  "cadence-quick-picks": {
    node: () => <CadencePicker value={DAILY_CADENCE} onChange={noop} />,
    // The quick picks are the moved buttons; the mode rail is upstream's segmented control.
    only: '[data-testid^="cadence-quick-"]',
  },
  "model-list-retry": {
    node: () => (
      <ModelList
        rows={[]}
        hiddenCount={0}
        status={MODEL_LOAD_ERROR}
        emptyText="No models"
        showProvider={false}
        grouped={false}
        highlights={NO_HIGHLIGHTS}
        selectedKey=""
        highlightIndex={-1}
        favorites={[]}
        serverId={null}
        onPick={noop}
        onShowMore={noop}
        onToggleFavorite={noop}
        onRetry={noop}
      />
    ),
  },
  "profile-list-create": {
    node: () => (
      <ProfileList
        profiles={NO_PROFILES}
        emptyText="No agent profiles on this Host yet"
        onEditProfiles={noop}
      />
    ),
  },
  "provider-header-retry": {
    node: () => (
      <ProviderHeader
        provider={CLAUDE_PROVIDER}
        serverId={null}
        refresh={FAILED_REFRESH}
        canMoveUp={false}
        canMoveDown={false}
        onMove={noop}
      />
    ),
  },
  "search-scope-undo": {
    node: () => <UndoToast label="Clisbot release work" />,
  },
};

function renderSubject(node: React.ReactElement) {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <View testID="frame" style={FRAME_STYLE}>
          {node}
        </View>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

/** Buttons Button draws: its Pressable carries role=button and holds a text label. */
function labelledButtons(frame: HTMLElement, only?: string): HTMLElement[] {
  const selector = only ?? '[role="button"], [role="radio"]';
  return [...frame.querySelectorAll<HTMLElement>(selector)].filter(
    (el) => (el.textContent ?? "").trim().length > 0 && el.closest('[role="button"] *') === null,
  );
}

afterEach(() => cleanup());

describe.each([320, 375])("sm buttons at %ipt wide", (width) => {
  it.each(Object.keys(subjects))(
    "%s keeps every button on its row, one line, touch-sized",
    async (name) => {
      await page.viewport(width, 740);
      renderSubject(subjects[name]!.node());
      const frame = screen.getByTestId("frame");
      const frameRect = frame.getBoundingClientRect();
      const buttons = labelledButtons(frame, subjects[name]!.only);
      expect(buttons.length, `${name} renders its sm buttons`).toBeGreaterThan(0);
      for (const button of buttons) {
        const rect = button.getBoundingClientRect();
        const label = (button.textContent ?? "").trim();
        expect(rect.height, `${name} "${label}" height`).toBeGreaterThanOrEqual(32);
        expect(rect.left, `${name} "${label}" left`).toBeGreaterThanOrEqual(frameRect.left - 0.5);
        expect(rect.right, `${name} "${label}" right`).toBeLessThanOrEqual(frameRect.right + 0.5);
        // One line: the label's text box is no taller than a single sm line.
        const text = [...button.querySelectorAll<HTMLElement>("*")].find(
          (el) => el.children.length === 0 && (el.textContent ?? "").trim() === label,
        );
        if (text) {
          expect(text.getBoundingClientRect().height, `${name} "${label}" wraps`).toBeLessThan(24);
        }
      }
      expect(frame.scrollWidth, `${name} overflows`).toBeLessThanOrEqual(frame.clientWidth + 1);
    },
  );
});
