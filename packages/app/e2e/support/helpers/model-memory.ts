import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, type Page } from "../fixtures";
import { expectComposerModel, pickComposerModel } from "./composer-picker";
import {
  DEVICE_FORM_PREFERENCES_KEY,
  hostFormPreferencesKey,
  readHostFormPreferences,
} from "./form-preferences";

export async function startWithoutRememberedModel(page: Page) {
  await page.addInitScript(
    (keys) => {
      for (const key of keys) localStorage.removeItem(key);
    },
    [DEVICE_FORM_PREFERENCES_KEY, hostFormPreferencesKey()],
  );
}

export async function chooseModel(page: Page, provider: string, label: string) {
  await pickComposerModel(page, { provider, label });
}

/** Picks the remembered model again: the panel opens on its provider with it checked. */
export async function reselectModel(page: Page, provider: string, label: string) {
  await expectRememberedModel(page, label);
  await pickComposerModel(page, { provider, label });
}

export async function expectSavedSelection(page: Page, provider: string, model: string) {
  await expect
    .poll(() => readHostFormPreferences(page))
    .toMatchObject({ provider, providerPreferences: { [provider]: { model } } });
}

export async function expectCreatedModelAgents(
  page: Page,
  client: DaemonClient,
  provider: string,
  model: string,
  count: number,
) {
  await expect
    .poll(
      async () => {
        const result = await client.fetchAgents({ scope: "active" });
        return result.entries
          .filter(({ agent }) => agent.provider === provider)
          .map(({ agent }) => agent.model);
      },
      { timeout: 60_000 },
    )
    .toEqual(Array(count).fill(model));
  await expect(page.getByTestId(/^workspace-tab-agent_/).filter({ visible: true })).toHaveCount(1);
}

export async function expectRememberedModel(page: Page, label: string) {
  await expectComposerModel(page, label);
}
