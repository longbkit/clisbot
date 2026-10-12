// @vitest-environment jsdom
import { createElement, type PropsWithChildren } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AsyncStorageCreateAgentPreferenceStorage,
  CREATE_AGENT_PREFERENCES_STORAGE_KEY,
} from "@/create-agent-preferences/storage";
import { CreateAgentPreferencesService } from "@/create-agent-preferences/service";

const stored = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => stored.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      stored.set(key, value);
    },
    removeItem: async (key: string) => {
      stored.delete(key);
    },
  },
}));
afterEach(cleanup);

import { mergeProviderPreferences, useFormPreferences } from "./use-form-preferences";

describe("mergeProviderPreferences", () => {
  it("stores the selected model for a provider", () => {
    expect(
      mergeProviderPreferences({
        preferences: {},
        provider: "claude",
        updates: { model: "claude-opus-4-6" },
      }),
    ).toEqual({
      provider: "claude",
      providerPreferences: {
        claude: {
          model: "claude-opus-4-6",
        },
      },
    });
  });

  it("merges thinking preferences by model without dropping existing entries", () => {
    expect(
      mergeProviderPreferences({
        preferences: {
          provider: "claude",
          providerPreferences: {
            claude: {
              model: "claude-sonnet-4-6",
              thinkingByModel: {
                "claude-sonnet-4-6": "medium",
              },
            },
          },
        },
        provider: "claude",
        updates: {
          thinkingByModel: {
            "claude-opus-4-6": "high",
          },
        },
      }),
    ).toEqual({
      provider: "claude",
      providerPreferences: {
        claude: {
          model: "claude-sonnet-4-6",
          thinkingByModel: {
            "claude-sonnet-4-6": "medium",
            "claude-opus-4-6": "high",
          },
        },
      },
    });
  });

  it("merges feature values without dropping existing entries", () => {
    expect(
      mergeProviderPreferences({
        preferences: {
          provider: "codex",
          providerPreferences: {
            codex: {
              model: "gpt-5.4",
              featureValues: {
                fast_mode: true,
              },
            },
          },
        },
        provider: "codex",
        updates: {
          featureValues: {
            plan_mode: true,
          },
        },
      }),
    ).toEqual({
      provider: "codex",
      providerPreferences: {
        codex: {
          model: "gpt-5.4",
          featureValues: {
            fast_mode: true,
            plan_mode: true,
          },
        },
      },
    });
  });
});

it("keeps Host choices separate across switching and storage reloads", async () => {
  stored.set(CREATE_AGENT_PREFERENCES_STORAGE_KEY, JSON.stringify({ provider: "legacy" }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children);
  const { result, rerender } = renderHook(({ serverId }) => useFormPreferences(serverId), {
    initialProps: { serverId: "saas" },
    wrapper,
  });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(() => result.current.updatePreferences({ provider: "codex-oauth-1" }));
  const updateSaas = result.current.updatePreferences;
  rerender({ serverId: "product" });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.preferences.provider).toBe("legacy");
  await act(() => result.current.updatePreferences({ provider: "codex-official-1" }));
  // A callback retained by an in-flight action still writes its original Host.
  await act(() => updateSaas({ provider: "saas-new" }));
  await waitFor(() => expect(result.current.preferences.provider).toBe("codex-official-1"));
  rerender({ serverId: "saas" });
  await waitFor(() => expect(result.current.preferences.provider).toBe("saas-new"));
  expect(
    await new CreateAgentPreferencesService(
      new AsyncStorageCreateAgentPreferenceStorage("product"),
    ).load(),
  ).toMatchObject({ provider: "codex-official-1" });
  expect(JSON.parse(stored.get(CREATE_AGENT_PREFERENCES_STORAGE_KEY)!)).toEqual({
    provider: "legacy",
  });
});
