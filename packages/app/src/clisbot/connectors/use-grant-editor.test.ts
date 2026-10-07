/** @vitest-environment jsdom */
/* eslint-disable max-nested-callbacks */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConnectorGrant } from "@clisbot/protocol/connectors/types";
import { grantApp, grantMcpServer, setAppEnabled } from "./model";
import { useGrantEditor, type GrantEdit } from "./use-grant-editor";

afterEach(cleanup);

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** A Host holding one Project's grant; each save waits until the test lets it through. */
function fakeHost(initial: ConnectorGrant | undefined) {
  const host = { grant: initial, saves: [] as ReturnType<typeof deferred>[] };
  const onSave = async (edit: GrantEdit) => {
    const done = deferred();
    host.saves.push(done);
    await done.promise;
    host.grant = edit(host.grant);
    return host.grant;
  };
  return { host, onSave };
}

describe("useGrantEditor", () => {
  it("saves in order and, after a failed save, drops the queued ones and shows the Host's grant", async () => {
    const { host, onSave } = fakeHost(undefined);
    const { result } = renderHook(() => useGrantEditor(undefined, onSave));
    act(() => result.current.apply((grant) => grantApp(grant, "gmail")));
    act(() => result.current.apply((grant) => grantMcpServer(grant, "notes")));
    expect(Object.keys(result.current.grant?.mcpServers ?? {})).toEqual(["notes"]);
    // The second save waits for the first.
    await act(async () => Promise.resolve());
    expect(host.saves).toHaveLength(1);
    await act(async () => {
      host.saves[0]!.reject(new Error("Only the Host's owner can change Connectors."));
      await host.saves[0]!.promise.catch(() => undefined);
    });
    expect(host.saves).toHaveLength(1);
    expect(result.current.grant).toBeUndefined();
    expect(result.current.error).toBe("Only the Host's owner can change Connectors.");
  });

  it("keeps an app added elsewhere while this editor's copy was stale", async () => {
    const { host, onSave } = fakeHost(grantApp(undefined, "gmail"));
    const { result } = renderHook(() => useGrantEditor(grantApp(undefined, "gmail"), onSave));
    // A card's Allow on another device adds Slack; this editor has not heard of it yet.
    host.grant = grantApp(host.grant, "slack");
    act(() => result.current.apply((grant) => setAppEnabled(grant, "gmail", false)));
    expect(Object.keys(result.current.grant?.apps ?? {})).toEqual(["gmail"]);
    await act(async () => Promise.resolve());
    await act(async () => {
      host.saves[0]!.resolve();
      await host.saves[0]!.promise;
    });
    expect(host.grant?.apps?.slack).toBeDefined();
    expect(host.grant?.apps?.gmail?.enabled).toBe(false);
    expect(result.current.grant).toEqual(host.grant);
  });

  it("shows a grant changed elsewhere when nothing is being saved", () => {
    const { onSave } = fakeHost(undefined);
    const { result, rerender } = renderHook(({ saved }) => useGrantEditor(saved, onSave), {
      initialProps: { saved: undefined as ConnectorGrant | undefined },
    });
    const changed = grantApp(undefined, "github");
    rerender({ saved: changed });
    expect(result.current.grant).toEqual(changed);
  });
});
