import { describe, expect, it } from "vitest";

const { configureBackKeepsTask } = require("./with-android-back-keeps-task");

// Expo's MainActivity template (SDK 50 and later).
const TEMPLATE = `package com.clisbot.app

import android.os.Build
import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "main"

  /**
   * Align the back button behavior with Android S
   * where moving root activities to background instead of finishing activities.
   */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              super.invokeDefaultOnBackPressed()
          }
          return
      }
      super.invokeDefaultOnBackPressed()
  }
}
`;

describe("withAndroidBackKeepsTask", () => {
  it("moves the task to the back on every Android version", () => {
    const configured = configureBackKeepsTask(TEMPLATE);
    expect(configured).not.toContain("Build.VERSION_CODES.R");
    expect(configured).not.toContain("Align the back button");
    expect(configured.match(/override fun invokeDefaultOnBackPressed\(\)/g)).toHaveLength(1);
    expect(configured).toContain("if (!moveTaskToBack(false)) {");
    expect(configured).toContain("override fun getMainComponentName()");
    expect(configured.trimEnd().endsWith("}")).toBe(true);
    expect(configureBackKeepsTask(configured)).toBe(configured);
  });

  it("keeps an earlier function's doc comment when the override has none", () => {
    const source = TEMPLATE.replace(/  \/\*\*\n   \* Align[\s\S]*?\*\/\n/, "").replace(
      "  override fun getMainComponentName",
      "  /** The registered component. */\n  override fun getMainComponentName",
    );
    const configured = configureBackKeepsTask(source);
    expect(configured).toContain("/** The registered component. */");
    expect(configured).toContain("override fun getMainComponentName()");
  });

  it("adds the override to an activity without one", () => {
    const source = `class MainActivity : ReactActivity() {\n  override fun getMainComponentName(): String = "main"\n}\n`;
    const configured = configureBackKeepsTask(source);
    expect(configured).toContain("override fun invokeDefaultOnBackPressed()");
    expect(configured.indexOf("getMainComponentName")).toBeLessThan(
      configured.indexOf("invokeDefaultOnBackPressed"),
    );
    expect(configureBackKeepsTask(configured)).toBe(configured);
  });
});
