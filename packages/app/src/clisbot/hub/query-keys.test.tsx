// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFetchQuery } from "@/data/query";
import { hubResourceQueryKey } from "./query-keys";

describe("Hub resource cache authority", () => {
  it.each([
    {
      resource: "daemons",
      suffix: [],
      previousData: { daemons: [{ id: "private-host" }] },
    },
    {
      resource: "access-assignments",
      suffix: ["effective"],
      previousData: {
        owner: false,
        grants: [
          {
            resource: { id: "automation-1", kind: "automation", available: true },
            privileges: ["automation.run"],
          },
        ],
      },
    },
  ])(
    "isolates $resource while a different account's fetch is pending or fails",
    async ({ resource, suffix, previousData }) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const scope = { origin: "https://hub.example.test", organizationId: "org-1" };
      client.setQueryData(
        [...hubResourceQueryKey({ ...scope, accountId: "previous-account" }, resource), ...suffix],
        previousData,
      );
      let rejectMember!: (error: Error) => void;
      const memberFetch = new Promise<typeof previousData>((_resolve, reject) => {
        rejectMember = reject;
      });
      const { result, rerender, unmount } = renderHook(
        ({ accountId }) => {
          const query = useFetchQuery(
            {
              queryKey: [...hubResourceQueryKey({ ...scope, accountId }, resource), ...suffix],
              queryFn: () =>
                accountId === "previous-account" ? Promise.resolve(previousData) : memberFetch,
              dataShape: "value",
              staleTimeMs: 0,
              retry: false,
            },
            client,
          );
          return {
            data: query.data,
            isError: query.isError,
            isPlaceholderData: query.isPlaceholderData,
          };
        },
        { initialProps: { accountId: "previous-account" } },
      );
      try {
        expect(result.current.data).toEqual(previousData);
        rerender({ accountId: "member" });
        expect(result.current.data).toBeUndefined();
        expect(result.current.isPlaceholderData).toBe(false);
        await act(async () => rejectMember(new Error("Hub unavailable")));
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.data).toBeUndefined();
      } finally {
        unmount();
        client.clear();
      }
    },
  );
});
