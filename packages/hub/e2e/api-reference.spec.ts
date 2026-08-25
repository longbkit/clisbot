import { expect, type Page, type Response } from "@playwright/test";
import { test } from "./app.js";

test("loads the self-hosted public API reference and its three operation groups", async ({
  hub,
  page,
}) => {
  test.setTimeout(60_000);
  await hub.visitHome();
  const evidence = monitorReferenceIsolation(page);
  const response = await visitApiReference(page);

  await expectApiReferenceOperations(page);
  expectRestrictivePolicy(response);
  expect(evidence.externalRequests).toEqual([]);
  expect(evidence.policyViolations).toEqual([]);
});

function monitorReferenceIsolation(page: Page): {
  externalRequests: string[];
  policyViolations: string[];
} {
  const origin = new URL(page.url()).origin;
  const externalRequests: string[] = [];
  const policyViolations: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== origin) externalRequests.push(request.url());
  });
  page.on("console", (message) => {
    if (/content security policy|violates.*directive/iu.test(message.text())) {
      policyViolations.push(message.text());
    }
  });
  return { externalRequests, policyViolations };
}

async function visitApiReference(page: Page): Promise<Response> {
  const origin = new URL(page.url()).origin;
  const spec = page.waitForResponse(`${origin}/api/openapi.json`);
  const response = await page.goto(`${origin}/api/reference`);
  expect(response).not.toBeNull();
  expect(response!.status()).toBe(200);
  expect((await spec).status()).toBe(200);
  return response!;
}

async function expectApiReferenceOperations(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /^Configurations /u })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Runs /u })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Daemons /u })).toBeVisible();
}

function expectRestrictivePolicy(response: Response): void {
  const policy = response.headers()["content-security-policy"];
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("frame-ancestors 'none'");
}
