// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QuestionFormCard } from "@/components/question-form-card";
import type { PendingPermission } from "@/types/shared";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => true }));
vi.mock("@/constants/platform", () => ({ isWeb: true }));
vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => <span data-testid="pending-spinner" />,
}));
vi.mock("@/components/ui/text-input", () => ({ EditingTextInput: () => null }));
vi.mock("lucide-react-native", () => ({ Check: () => <i />, X: () => <i /> }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    testID,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel: string;
    testID?: string;
  }) => (
    <button
      type="button"
      aria-label={accessibilityLabel}
      data-testid={testID}
      onClick={onPress}
      disabled={disabled}
    >
      {children}
    </button>
  ),
}));
afterEach(cleanup);
const permission: PendingPermission = {
  key: "q",
  agentId: "a",
  request: {
    id: "q",
    name: "AskUserQuestion",
    provider: "codex",
    kind: "question",
    input: { questions: [{ question: "Ship?", header: "Release", options: [{ label: "Yes" }] }] },
  },
};
it.each(["primary-action", "dismiss"])(
  "restores the %s label and retry after pending delivery fails",
  (action) => {
    const respond = vi.fn();
    const { rerender } = render(
      <QuestionFormCard permission={permission} isResponding={false} onRespond={respond} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    const testId = `question-form-${action}`;
    const originalLabel = screen.getByTestId(testId).textContent;
    fireEvent.click(screen.getByTestId(testId));
    expect(respond).toHaveBeenCalledTimes(1);
    rerender(<QuestionFormCard permission={permission} isResponding onRespond={respond} />);
    expect(screen.getByTestId("pending-spinner")).toBeTruthy();
    fireEvent.click(screen.getByTestId(testId));
    expect(respond).toHaveBeenCalledTimes(1);
    rerender(<QuestionFormCard permission={permission} isResponding={false} onRespond={respond} />);
    expect(screen.queryByTestId("pending-spinner")).toBeNull();
    expect(screen.getByTestId(testId).textContent).toBe(originalLabel);
    fireEvent.click(screen.getByTestId(testId));
    expect(respond).toHaveBeenCalledTimes(2);
  },
);
