// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { WhatIsHub } from "./hub-help";
const storage = vi.hoisted(() => ({ value: null as string | null, set: vi.fn() }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => storage.value,
    setItem: async (_key: string, value: string) => {
      storage.value = value;
      storage.set(value);
    },
  },
}));
afterEach(cleanup);
test("Hub help defaults expanded, shares collapse across screens and remembers remount", async () => {
  const first = render(
    <>
      <WhatIsHub />
      <WhatIsHub />
    </>,
  );
  await waitFor(() => expect(screen.getAllByText(/A Hub manages channels/)).toHaveLength(2));
  expect(
    screen.getAllByRole("button", { name: "What is a Hub?" })[0].getAttribute("aria-expanded"),
  ).toBe("true");
  fireEvent.click(screen.getAllByRole("button", { name: "What is a Hub?" })[0]);
  expect(screen.queryByText(/A Hub manages channels/)).toBeNull();
  for (const disclosure of screen.getAllByRole("button", { name: "What is a Hub?" })) {
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  }
  await waitFor(() => expect(storage.set).toHaveBeenCalledWith("false"));
  first.unmount();
  render(<WhatIsHub />);
  expect(screen.queryByText(/A Hub manages channels/)).toBeNull();
  expect(screen.getByRole("button", { name: "What is a Hub?" }).getAttribute("aria-expanded")).toBe(
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: "What is a Hub?" }));
  expect(screen.getByText(/A Hub manages channels/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "What is a Hub?" }).getAttribute("aria-expanded")).toBe(
    "true",
  );
});
