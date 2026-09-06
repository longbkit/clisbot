// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHubConnectionContinuation } from "./use-connection-continuation";

const { openURL } = vi.hoisted(() => ({ openURL: vi.fn() }));
vi.mock("expo-linking", () => ({ openURL }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("provider connection continuation", () => {
  it("keeps the same setup attempt after a popup failure and reopens it without resubmitting credentials", async () => {
    const url = "https://provider.example.test/authorize?state=existing-attempt";
    openURL.mockRejectedValueOnce(new Error("Popup blocked"));
    const { result } = renderHook(() => useHubConnectionContinuation());
    await act(() => result.current.open(url));
    expect(result.current.url).toBe(url);
    expect(result.current.error).toContain("Continue setup");
    expect(result.current.pending).toBe(false);

    openURL.mockResolvedValueOnce(undefined);
    await act(() => result.current.retry());
    expect(openURL.mock.calls).toEqual([[url], [url]]);
    expect(result.current.error).toBe(null);
    expect(result.current.url).toBe(url);
  });

  it("retains a recovery link even when a browser reports success without displaying the window", async () => {
    openURL.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useHubConnectionContinuation());
    await act(() => result.current.open("https://provider.example.test/authorize"));
    expect(result.current.url).toBe("https://provider.example.test/authorize");
    act(() => result.current.dismiss());
    expect(result.current.url).toBe(null);
    expect(result.current.error).toBe(null);
    act(() => result.current.retry());
    expect(openURL).toHaveBeenCalledTimes(1);
  });
  it("does not restore a dismissed setup when an opening attempt finishes late", async () => {
    let complete!: () => void;
    openURL.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const { result } = renderHook(() => useHubConnectionContinuation());
    let opening!: Promise<void>;
    act(() => {
      opening = result.current.open("https://provider.example.test/authorize");
    });
    expect(result.current.pending).toBe(true);
    act(() => result.current.dismiss());
    await act(async () => {
      complete();
      await opening;
    });
    expect(result.current.url).toBe(null);
    expect(result.current.pending).toBe(false);
  });
});
