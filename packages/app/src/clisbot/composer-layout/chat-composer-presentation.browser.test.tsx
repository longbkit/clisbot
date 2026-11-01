import React, { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { Text, View } from "react-native";
import { i18n } from "@/i18n/i18next";
import {
  ChatComposerPresentation,
  type ChatComposerPresentationProps,
  type ChatComposerSlots,
} from "./chat-composer-presentation";
import { useSettingsRowCountLabel } from "./settings-row";

vi.mock("react-native-unistyles", async () => {
  const { lightTheme } = await import("@/styles/theme");
  const { StyleSheet } = await import("react-native");
  return {
    StyleSheet: {
      ...StyleSheet,
      create: <T,>(styles: T | ((theme: typeof lightTheme) => T)): T =>
        typeof styles === "function"
          ? (styles as (theme: typeof lightTheme) => T)(lightTheme)
          : styles,
    },
    withUnistyles: <T,>(component: T): T => component,
    UnistylesRuntime: { breakpoint: "lg" },
    useUnistyles: () => ({ theme: lightTheme, rt: { breakpoint: "lg" } }),
  };
});

beforeAll(async () => {
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("en");
});
afterEach(() => cleanup());

const PIECE_STYLE = { width: 28, height: 28 };
const FRAMES = { wide: { width: 720 }, narrow: { width: 320 } } as const;

function Piece({ id }: { id: string }) {
  return <View testID={id} style={PIECE_STYLE} />;
}

/** A Tools chip stand-in: what it would print in the settings row. */
function CountProbe() {
  const chip = useSettingsRowCountLabel("Tools · 3", 3);
  return <Text testID="tools-probe">{chip.showLabel ? chip.value : "(icon)"}</Text>;
}

function slots(overrides: Partial<ChatComposerSlots> = {}): ChatComposerSlots {
  return {
    commands: <Piece id="commands" />,
    attach: <Piece id="attach" />,
    realtimeVoice: <Piece id="voice" />,
    dictation: <Piece id="dictation" />,
    sendable: false,
    typing: false,
    primary: null,
    settings: (
      <>
        <Piece id="model" />
        <Piece id="mode" />
        <CountProbe />
      </>
    ),
    settingsEnd: <Piece id="ring" />,
    ...overrides,
  };
}

function mount(
  overrides: Partial<ChatComposerPresentationProps> = {},
  frame: keyof typeof FRAMES = "wide",
) {
  const props: ChatComposerPresentationProps = {
    fullscreen: false,
    compact: false,
    multiline: false,
    hasAttachments: false,
    sendIconSize: 20,
    surface: <Text testID="surface">Message…</Text>,
    error: null,
    onExit: vi.fn(),
    inputWrapperRef: createRef<View>(),
    pillStyle: undefined,
    inputOpacity: 1,
    inputPointerEvents: "auto",
    attachmentSlot: null,
    showFullscreenButton: false,
    onEnter: vi.fn(),
    overlay: null,
    slots: slots(),
    ...overrides,
  };
  render(
    <View style={FRAMES[frame]}>
      <ChatComposerPresentation {...props} />
    </View>,
  );
}

function within(parentId: string, childId: string): boolean {
  return screen.getByTestId(parentId).contains(screen.getByTestId(childId));
}

it("holds Commands, the text, attach, voice and the mic circle in one container", async () => {
  await page.viewport(1280, 900);
  mount();
  expect(within("composer-inner-start", "commands")).toBe(true);
  expect(within("composer-inner-end", "attach")).toBe(true);
  expect(within("composer-inner-end", "voice")).toBe(true);
  expect(within("composer-pill", "surface")).toBe(true);
  expect(within("composer-circle", "dictation")).toBe(true);
  expect(within("composer-pill", "composer-circle")).toBe(true);
});

it("turns the circle into Send once something is sendable, hides voice and keeps attach", async () => {
  await page.viewport(390, 844);
  mount({
    compact: true,
    slots: slots({ sendable: true, typing: true, primary: <Piece id="send" /> }),
  });
  expect(within("composer-circle", "send")).toBe(true);
  expect(screen.queryByTestId("dictation")).toBeNull();
  expect(within("composer-inner-end", "attach")).toBe(true);
  expect(screen.queryByTestId("voice")).toBeNull();
  expect(within("composer-inner-start", "commands")).toBe(true);
});

it("moves the mic inside while Stop holds the circle on an empty draft", async () => {
  await page.viewport(1280, 900);
  mount({ slots: slots({ primary: <Piece id="stop" /> }) });
  expect(within("composer-circle", "stop")).toBe(true);
  expect(within("composer-inner-end", "dictation")).toBe(true);
});

it("holds model, mode, tools and the ring in the row under the container", async () => {
  await page.viewport(1280, 900);
  mount();
  for (const id of ["model", "mode", "tools-probe", "ring"]) {
    expect(within("composer-settings-row", id)).toBe(true);
  }
  const container = screen.getByTestId("composer-pill").getBoundingClientRect();
  const row = screen.getByTestId("composer-settings-row").getBoundingClientRect();
  expect(row.top).toBeGreaterThanOrEqual(container.bottom);
  expect(row.left).toBe(container.left);
  expect(screen.getByTestId("tools-probe").textContent).toBe("Tools · 3");
});

it("collapses the Tools chip to its count in a narrow row", async () => {
  await page.viewport(1280, 900);
  mount({}, "narrow");
  await expect.poll(() => screen.getByTestId("tools-probe").textContent).toBe("3");
});

it("drops the settings row and Commands where a surface hides them", async () => {
  await page.viewport(1280, 900);
  mount({ slots: slots({ settings: null, settingsEnd: null, commands: null, attach: null }) });
  expect(screen.queryByTestId("composer-settings-row")).toBeNull();
  expect(screen.queryByTestId("composer-inner-start")).toBeNull();
});

it("keeps the collapsed layout in the expanded editor; only the text grows", async () => {
  await page.viewport(390, 844);
  mount({ fullscreen: true, compact: true, slots: slots({ primary: <Piece id="send" /> }) });
  expect(screen.getByTestId("composer-fullscreen")).toBeTruthy();
  expect(within("composer-inner-start", "commands")).toBe(true);
  expect(within("composer-inner-end", "attach")).toBe(true);
  expect(within("composer-circle", "send")).toBe(true);
  expect(within("composer-pill", "composer-circle")).toBe(true);
  const container = screen.getByTestId("composer-pill").getBoundingClientRect();
  const row = screen.getByTestId("composer-settings-row").getBoundingClientRect();
  expect(row.top).toBeGreaterThanOrEqual(container.bottom);
  expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeTruthy();
});

it("keeps attach and the mic inside while only attachments make it sendable", async () => {
  await page.viewport(1280, 900);
  mount({ slots: slots({ sendable: true, primary: <Piece id="send" /> }) });
  expect(within("composer-circle", "send")).toBe(true);
  expect(within("composer-inner-end", "attach")).toBe(true);
  expect(within("composer-inner-end", "dictation")).toBe(true);
});
