// @vitest-environment jsdom
import React from "react";
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { AgentMode } from "@clisbot/protocol/agent-types";
import { FULL_AUTO_ACCEPT_MODE_ID } from "@clisbot/protocol/full-auto-accept";
import {
  AGENT_PROVIDER_DEFINITIONS,
  DEV_AGENT_PROVIDER_DEFINITIONS,
} from "@clisbot/protocol/provider-manifest";
import { i18n } from "@/i18n/i18next";
import { buildComposerModeOptions, resolveModeLabelKey } from "./mode-options";
import { useModePresentation } from "./mode-presentation";
import { resolvePermissionCarry } from "./permission-carry";
import { ProviderSwitchReview, type ProviderSwitchReviewInput } from "./provider-switch-review";

/**
 * The names a person reads for each mode, with the real translations: the Mode picker, its chip
 * and the provider-switch review all use them. Known native modes read in the common agent
 * vocabulary (Plan mode, Edit mode, Auto review, Full auto-accept) with the provider's own name
 * beside them where it differs; Clisbot's overlay reads Clisbot Full auto-accept; every other
 * mode keeps the provider's own name.
 */

vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
}));
vi.mock("@/components/ui/button", () => ({
  Button: (props: { children: React.ReactNode; onPress?: () => void; testID?: string }) => (
    <button type="button" data-testid={props.testID} onClick={props.onPress}>
      {props.children}
    </button>
  ),
}));
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: (props: {
    header: { title: string };
    children: React.ReactNode;
    footer: React.ReactNode;
    testID?: string;
  }) => (
    <div data-testid={props.testID} role="dialog" aria-label={props.header.title}>
      {props.children}
      {props.footer}
    </div>
  ),
}));

beforeAll(() => {
  vi.stubGlobal("React", React);
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

const CUSTOM_ACP: AgentMode[] = [
  { id: "careful", label: "Careful" },
  { id: "foo#plan", label: "Plan-ish", colorTier: "planning" },
  { id: "yolo", label: "Bypass everything", colorTier: "dangerous" },
  { id: "unattended", label: "Unattended", isUnattended: true },
];

const CATALOG: { provider: string; modes: readonly AgentMode[] }[] = [
  ...[...AGENT_PROVIDER_DEFINITIONS, ...DEV_AGENT_PROVIDER_DEFINITIONS].map((definition) => ({
    provider: definition.id,
    modes: definition.modes,
  })),
  { provider: "acme-acp", modes: CUSTOM_ACP },
];

function nameTable(language: string) {
  const { result } = renderHook(() => useModePresentation());
  const rows: string[] = [];
  for (const { provider, modes } of CATALOG)
    for (const mode of buildComposerModeOptions(modes, true)) {
      const shown = result.current(provider, mode);
      rows.push(
        `| ${language} | ${provider} | ${mode.id} | ${shown.label} | ${shown.providerName ?? ""} |`,
      );
    }
  return rows;
}

describe("mode names over the whole catalog", () => {
  test.each(["en", "vi"])("%s", async (language) => {
    await i18n.changeLanguage(language);
    const rows = nameTable(language);
    expect(rows.join("\n")).toMatchSnapshot();
  });

  test("the requested names in English and Vietnamese, with the provider's own name beside", async () => {
    for (const language of ["en", "vi"]) {
      await i18n.changeLanguage(language);
      const { result } = renderHook(() => useModePresentation());
      const show = (provider: string, id: string, label: string) =>
        result.current(provider, { id, label });
      expect(show("claude", "plan", "Plan Mode")).toMatchObject({
        label: "Plan mode",
        providerName: undefined,
      });
      expect(show("claude", "acceptEdits", "Accept File Edits")).toMatchObject({
        label: "Edit mode",
        providerName: "Accept file edits",
      });
      expect(show("codex", "auto-review", "Auto-review")).toMatchObject({
        label: "Auto review",
        providerName: undefined,
      });
      for (const [provider, id, label, own] of [
        ["claude", "bypassPermissions", "Bypass", "Bypass"],
        ["codex", "full-access", "Full Access", "Full access"],
        ["copilot", "allow-all", "Allow all", "Allow all"],
        ["omp", "full", "Full Access", "Full access"],
      ] as const)
        expect(show(provider, id, label)).toMatchObject({
          label: "Full auto-accept",
          providerName: own,
        });
      expect(show("claude", FULL_AUTO_ACCEPT_MODE_ID, "Full auto-accept")).toMatchObject({
        label: "Clisbot Full auto-accept",
        providerName: undefined,
      });
    }
  });

  test("Ask and Default stay distinct and keep their translated names", async () => {
    await i18n.changeLanguage("vi");
    const { result } = renderHook(() => useModePresentation());
    expect(result.current("claude", { id: "default", label: "Always Ask" }).label).toBe("Luôn hỏi");
    expect(result.current("codex", { id: "auto", label: "Default Permissions" }).label).toBe(
      "Quyền mặc định",
    );
    expect(result.current("omp", { id: "write", label: "Write Approval" }).label).toBe(
      "Duyệt khi ghi",
    );
  });

  test("a custom mode keeps its own name, whatever its id, label or color suggests", async () => {
    await i18n.changeLanguage("vi");
    const { result } = renderHook(() => useModePresentation());
    for (const mode of CUSTOM_ACP)
      expect(result.current("acme-acp", mode)).toMatchObject({
        label: mode.label,
        providerName: undefined,
      });
  });
});

interface ReviewCase {
  from: string;
  fromMode: AgentMode & { family: string };
  to: string;
  toFamily: string;
}

function buildReview(input: ReviewCase): ProviderSwitchReviewInput {
  const targetModes =
    CATALOG.find((entry) => entry.provider === input.toFamily)?.modes ?? ([] as AgentMode[]);
  const carry = resolvePermissionCarry({
    sourceFamily: input.fromMode.family,
    sourceModeId: input.fromMode.id,
    sourceModes: [input.fromMode],
    targetFamily: input.toFamily,
    targetModes,
    fullAutoAcceptSupported: true,
  });
  const fromPermission = {
    modeId: input.fromMode.id,
    label: input.fromMode.label,
    labelKey: resolveModeLabelKey(input.fromMode.family, input.fromMode.id),
    scope: null,
  };
  return { from: input.from, to: input.to, fromPermission, carry, history: "chat" };
}

function renderReview(input: ReviewCase) {
  const review = buildReview(input);
  render(<ProviderSwitchReview input={review} onCancel={vi.fn()} onConfirm={vi.fn()} />);
  return review.carry;
}

const text = (testID: string) => screen.getByTestId(testID).textContent;

describe("the provider-switch review reads the same names", () => {
  test("Codex Full auto-accept (Full access) → Claude Full auto-accept (Bypass), in English", async () => {
    renderReview({
      from: "Codex · GPT",
      fromMode: { family: "codex", id: "full-access", label: "Full Access" },
      to: "Claude · Opus",
      toFamily: "claude",
    });
    expect(text("provider-switch-from-permission")).toBe("Full auto-accept (Full access)");
    expect(text("provider-switch-to-permission")).toBe("Full auto-accept (Bypass)");
    expect(text("provider-switch-reason")).toBe(
      "Keeps the same permission: Full auto-accept (Bypass).",
    );
    expect(text("provider-switch-permission-bypassPermissions")).toBe("Full auto-accept  Bypass");
    expect(text(`provider-switch-permission-${FULL_AUTO_ACCEPT_MODE_ID}`)).toBe(
      "Clisbot Full auto-accept",
    );
    expect(text("provider-switch-permission-acceptEdits")).toBe("Edit mode  Accept file edits");
    expect(text("provider-switch-permission-plan")).toBe("Plan mode");
    expect(text("provider-switch-permission-default")).toBe("Always ask");
  });

  test("the same in Vietnamese: product names kept, explanations translated", async () => {
    await i18n.changeLanguage("vi");
    renderReview({
      from: "Codex · GPT",
      fromMode: { family: "codex", id: "full-access", label: "Full Access" },
      to: "Claude · Opus",
      toFamily: "claude",
    });
    expect(text("provider-switch-from-permission")).toBe("Full auto-accept (Full access)");
    expect(text("provider-switch-to-permission")).toBe("Full auto-accept (Bypass)");
    expect(text(`provider-switch-permission-${FULL_AUTO_ACCEPT_MODE_ID}`)).toBe(
      "Clisbot Full auto-accept",
    );
    expect(text("provider-switch-permission-default")).toBe("Luôn hỏi");
    expect(text("provider-switch-reason")).toBe("Giữ nguyên quyền: Full auto-accept (Bypass).");
    expect(screen.getByTestId("provider-switch-confirm").textContent).toBe("Bắt đầu phiên mới");
    expect(screen.getByTestId("provider-switch-cancel").textContent).toBe("Hủy");
  });

  test("an unknown custom mode is named as the provider names it, and nothing is chosen", async () => {
    const carry = renderReview({
      from: "Acme · Acme Model",
      fromMode: { family: "acme-acp", id: "foo#plan", label: "Plan-ish" },
      to: "Claude · Opus",
      toFamily: "claude",
    });
    expect(carry.reason).toBe("unknownSource");
    expect(text("provider-switch-from-permission")).toBe("Plan-ish");
    expect(text("provider-switch-to-permission")).toBe("choose below");
  });
});
