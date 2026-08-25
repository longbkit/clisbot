import { expect, type Page } from "@playwright/test";
import { test } from "./app.js";
import type { PaseoHub } from "./helpers/hub.js";

test("unknown pages, APIs, and browser probes have intentional 404s without router warnings", async ({
  hub,
  page,
}) => {
  await openUnknownPage(hub, page);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Return home" })).toBeVisible();

  const api = await page.request.get(`${hub.primaryApplication().origin}/api/unknown-operation`);
  expect(api.status()).toBe(404);
  await expect(api.json()).resolves.toEqual({
    error: "not_found",
    message: "This Paseo Hub API endpoint does not exist. Check the request path and API version.",
  });

  for (const path of ["/favicon.ico", "/.well-known/appspecific/com.chrome.devtools.json"]) {
    const response = await page.request.get(`${hub.primaryApplication().origin}${path}`);
    expect(response.status()).toBe(404);
  }

  expect(hub.primaryApplication().logs()).not.toContain("notFoundError was encountered");
  expect(hub.primaryApplication().logs()).not.toContain(
    "notFoundComponent option was not configured",
  );
});

async function openUnknownPage(hub: PaseoHub, page: Page) {
  const response = await page.goto(`${hub.primaryApplication().origin}/definitely-unknown`);
  expect(response?.status()).toBe(404);
}
