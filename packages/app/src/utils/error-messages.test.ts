import { expect, it } from "vitest";
import { toErrorMessage } from "./error-messages";

it("formats permission failures without leaking RPC details", () => {
  const error = Object.assign(
    new Error(
      "Session is not authorized for create_terminal_request requestType=create_terminal_request code=access_denied",
    ),
    { code: "access_denied" },
  );
  expect(toErrorMessage(error)).toBe(
    "You do not have permission to perform this action. Ask your administrator for access.",
  );
});
it("does not misclassify missing resources or ordinary errors", () => {
  expect(
    toErrorMessage(Object.assign(new Error("Resource not found"), { code: "resource_not_found" })),
  ).toBe("Resource not found");
  expect(toErrorMessage(new Error("Connection lost"))).toBe("Connection lost");
});
