import { describe, expect, it } from "vitest";

const { configureHttpPerHost } = require("./with-android-http-per-host");

// Expo's MainApplication template (SDK 55 and later), trimmed to what the plugin edits.
const TEMPLATE = `package com.clisbot.app

import android.app.Application
import expo.modules.ApplicationLifecycleDispatcher

class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }
}
`;

describe("withAndroidHttpPerHost", () => {
  it("installs the client factory before React Native loads, once", () => {
    const configured = configureHttpPerHost(TEMPLATE, 32);
    const factory = configured.indexOf("OkHttpClientProvider.setOkHttpClientFactory");
    expect(factory).toBeGreaterThan(configured.indexOf("super.onCreate()"));
    expect(factory).toBeLessThan(configured.indexOf("loadReactNative(this)"));
    expect(configured).toContain("maxRequestsPerHost = 32");
    // Keeps React Native's default client: its cookie jar and the 10 MB cache.
    expect(configured).toContain("provider.createClientBuilder(this@MainApplication)");
    expect(configureHttpPerHost(configured, 32)).toBe(configured);
  });

  it("fails loudly when the template no longer has super.onCreate()", () => {
    expect(() => configureHttpPerHost("class MainApplication {}", 32)).toThrow(/onCreate/);
  });
});
