import { describe, expect, it } from "vitest";
import { createInMemoryKeyValueStorage } from "./fakes";
import { APP_SETTINGS_KEY, SETTINGS_MIGRATIONS_KEY } from "./keys";
import { migrateAppSettings } from "./migrations";
import { DEFAULT_CLIENT_SETTINGS, type AppSettings, type SendBehavior } from "./storage";

function settingsWith(sendBehavior: SendBehavior): AppSettings {
  return { ...DEFAULT_CLIENT_SETTINGS, sendBehavior };
}

type Storage = ReturnType<typeof createInMemoryKeyValueStorage>;

function appliedIds(storage: Storage): string[] {
  const raw = storage.entries.get(SETTINGS_MIGRATIONS_KEY);
  return raw === undefined ? [] : JSON.parse(raw).applied;
}

function storedSendBehavior(storage: Storage): SendBehavior | undefined {
  const raw = storage.entries.get(APP_SETTINGS_KEY);
  return raw === undefined ? undefined : JSON.parse(raw).sendBehavior;
}

function storedContentFontSize(storage: Storage): number | undefined {
  const raw = storage.entries.get(APP_SETTINGS_KEY);
  return raw === undefined ? undefined : JSON.parse(raw).contentFontSize;
}

/** An in-memory storage whose write to `failingKey` always throws, as a full disk would. */
function createFailingWriteStorage(failingKey: string): Storage {
  const storage = createInMemoryKeyValueStorage();
  const setItem = storage.setItem.bind(storage);
  return Object.assign(storage, {
    async setItem(key: string, value: string) {
      if (key === failingKey) throw new Error(`write to ${key} failed`);
      await setItem(key, value);
    },
  });
}

describe("migrateAppSettings", () => {
  it("flips a stored interrupt to steer and marks itself applied", async () => {
    const storage = createInMemoryKeyValueStorage();

    const result = await migrateAppSettings(settingsWith("interrupt"), storage);

    expect(result.sendBehavior).toBe("steer");
    expect(storedSendBehavior(storage)).toBe("steer");
    expect(appliedIds(storage)).toEqual(["steer-default", "summary-with-latest-call-default"]);
  });

  it("leaves interrupt alone once the migration has run", async () => {
    const storage = createInMemoryKeyValueStorage();
    await migrateAppSettings(settingsWith("interrupt"), storage);

    const result = await migrateAppSettings(settingsWith("interrupt"), storage);

    expect(result.sendBehavior).toBe("interrupt");
  });

  it("leaves queue alone", async () => {
    const storage = createInMemoryKeyValueStorage();

    const result = await migrateAppSettings(settingsWith("queue"), storage);

    expect(result.sendBehavior).toBe("queue");
    expect(storage.entries.has(APP_SETTINGS_KEY)).toBe(false);
    expect(appliedIds(storage)).toEqual(["steer-default", "summary-with-latest-call-default"]);
  });

  it("marks itself applied on a fresh install without rewriting settings", async () => {
    const storage = createInMemoryKeyValueStorage();

    await migrateAppSettings(settingsWith("steer"), storage);

    expect(storage.entries.has(APP_SETTINGS_KEY)).toBe(false);
    expect(appliedIds(storage)).toEqual(["steer-default", "summary-with-latest-call-default"]);
  });

  it("keeps unknown migration ids written by a newer client", async () => {
    const storage = createInMemoryKeyValueStorage({
      [SETTINGS_MIGRATIONS_KEY]: JSON.stringify({ applied: ["some-later-migration"] }),
    });

    await migrateAppSettings(settingsWith("interrupt"), storage);

    expect(appliedIds(storage)).toEqual([
      "some-later-migration",
      "steer-default",
      "summary-with-latest-call-default",
    ]);
  });

  it("migrates every mobile 15px content preference to 16px", async () => {
    const storage = createInMemoryKeyValueStorage();
    const settings = { ...settingsWith("steer"), contentFontSize: 15 };

    const result = await migrateAppSettings(settings, storage, undefined, { native: true });

    expect(result.contentFontSize).toBe(16);
    expect(storedContentFontSize(storage)).toBe(16);
    expect(appliedIds(storage)).toEqual([
      "steer-default",
      "mobile-content-16",
      "summary-with-latest-call-default",
    ]);
  });

  it("leaves a 15px web content preference unchanged", async () => {
    const storage = createInMemoryKeyValueStorage();
    const settings = { ...settingsWith("steer"), contentFontSize: 15 };

    const result = await migrateAppSettings(settings, storage, undefined, { native: false });

    expect(result.contentFontSize).toBe(15);
    expect(storedContentFontSize(storage)).toBeUndefined();
    expect(appliedIds(storage)).toEqual(["steer-default", "summary-with-latest-call-default"]);
  });

  it("lets a mobile user choose 15px after the default migration ran", async () => {
    const storage = createInMemoryKeyValueStorage();
    await migrateAppSettings(
      { ...settingsWith("steer"), contentFontSize: 15 },
      storage,
      undefined,
      { native: true },
    );

    const result = await migrateAppSettings(
      { ...settingsWith("steer"), contentFontSize: 15 },
      storage,
      undefined,
      { native: true },
    );

    expect(result.contentFontSize).toBe(15);
  });

  it("stays unmarked when the settings write fails, so a later launch retries", async () => {
    const storage = createFailingWriteStorage(APP_SETTINGS_KEY);

    await expect(migrateAppSettings(settingsWith("interrupt"), storage)).rejects.toThrow();

    expect(appliedIds(storage)).toEqual([]);
  });

  it("re-runs harmlessly when the marker write fails after settings landed", async () => {
    const failing = createFailingWriteStorage(SETTINGS_MIGRATIONS_KEY);
    await expect(migrateAppSettings(settingsWith("interrupt"), failing)).rejects.toThrow();
    expect(storedSendBehavior(failing)).toBe("steer");

    const recovered = createInMemoryKeyValueStorage(Object.fromEntries(failing.entries));
    const result = await migrateAppSettings(settingsWith("steer"), recovered);

    expect(result.sendBehavior).toBe("steer");
    expect(appliedIds(recovered)).toEqual(["steer-default", "summary-with-latest-call-default"]);
  });
});

describe("latest-call default migration", () => {
  it.each(["overview", "detailed", "summary-with-latest-call"] as const)(
    "upgrades %s once, then preserves manual choices",
    async (level) => {
      const storage = createInMemoryKeyValueStorage();
      const initial = { ...DEFAULT_CLIENT_SETTINGS, toolCallDetailLevel: level };
      const upgraded = await migrateAppSettings(initial, storage);
      expect(upgraded.toolCallDetailLevel).toBe("summary-with-latest-call");
      expect(appliedIds(storage)).toContain("summary-with-latest-call-default");
      for (const selection of ["overview", "detailed"] as const) {
        const selected = { ...upgraded, toolCallDetailLevel: selection };
        expect((await migrateAppSettings(selected, storage)).toolCallDetailLevel).toBe(selection);
      }
    },
  );

  it("does not mark a failed preference write and retries after a failed marker write", async () => {
    const initial = { ...DEFAULT_CLIENT_SETTINGS, toolCallDetailLevel: "overview" as const };
    const failedSettings = createFailingWriteStorage(APP_SETTINGS_KEY);
    await expect(migrateAppSettings(initial, failedSettings)).rejects.toThrow();
    expect(appliedIds(failedSettings)).toEqual([]);
    const failedMarker = createFailingWriteStorage(SETTINGS_MIGRATIONS_KEY);
    await expect(migrateAppSettings(initial, failedMarker)).rejects.toThrow();
    const landed = JSON.parse(failedMarker.entries.get(APP_SETTINGS_KEY) ?? "null");
    expect(landed.toolCallDetailLevel).toBe("summary-with-latest-call");
    const recovered = createInMemoryKeyValueStorage(Object.fromEntries(failedMarker.entries));
    expect((await migrateAppSettings(landed, recovered)).toolCallDetailLevel).toBe(
      "summary-with-latest-call",
    );
    expect(appliedIds(recovered)).toContain("summary-with-latest-call-default");
  });
});

it("writes the upgraded display preference before its migration marker", async () => {
  const memory = createInMemoryKeyValueStorage();
  const writes: string[] = [];
  const storage = {
    ...memory,
    async setItem(key: string, value: string) {
      writes.push(key);
      await memory.setItem(key, value);
    },
  };
  await migrateAppSettings(
    { ...DEFAULT_CLIENT_SETTINGS, toolCallDetailLevel: "detailed" },
    storage,
  );
  expect(writes).toEqual([APP_SETTINGS_KEY, SETTINGS_MIGRATIONS_KEY]);
});
