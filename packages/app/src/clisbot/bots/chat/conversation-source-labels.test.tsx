// @vitest-environment jsdom
import { render, renderHook, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ReactNode } from "react";
import {
  ConversationSourceLabelsContext,
  useConversationSourceLabel,
  useConversationSourceLabelsBridge,
} from "./conversation-source-labels";
const labels = new Map([
  [JSON.stringify(["host", "analyst"]), "Analyst QA"],
  [JSON.stringify(["host", "writer"]), "Writer QA"],
]);
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <ConversationSourceLabelsContext.Provider value={labels}>
      {children}
    </ConversationSourceLabelsContext.Provider>
  );
}
function Option({ workspaceId }: { workspaceId: string }) {
  const label = useConversationSourceLabel({
    kind: "file",
    path: "README.md",
    workspaceContext: { serverId: "host", workspaceId },
  });
  return <div>README.md · {label}</div>;
}
it("preserves bot labels across the mobile sheet's separate rendering root", () => {
  const { result } = renderHook(useConversationSourceLabelsBridge, { wrapper: Wrapper });
  render(
    <>
      {result.current(<Option workspaceId="analyst" />)}
      {result.current(<Option workspaceId="writer" />)}
    </>,
  );
  expect(screen.getByText("README.md · Analyst QA")).toBeTruthy();
  expect(screen.getByText("README.md · Writer QA")).toBeTruthy();
});
