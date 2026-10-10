import { expect, type Page } from "@playwright/test";

/** Answer the rendered wide or compact confirmation and retain the text the user saw. */
export async function answerAppConfirmation(
  page: Page,
  answer: "accept" | "dismiss",
): Promise<{ message(): string }> {
  const dialog = page
    .getByTestId("app-confirmation")
    .getByRole("dialog")
    .or(
      page
        .getByRole("slider", { name: "Bottom Sheet", exact: true })
        .filter({ has: page.getByRole("button", { name: "Cancel", exact: true }) }),
    );
  await expect(dialog).toBeVisible();
  const message = await dialog.innerText();
  const action =
    answer === "accept"
      ? dialog.getByRole("button").last()
      : dialog.getByRole("button", { name: "Cancel", exact: true });
  await action.click();
  await expect(dialog).not.toBeVisible();
  return { message: () => message };
}
