import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Each test owns a PostgreSQL container and a Hub process. Half of the CI runner's
  // available CPUs leaves headroom for those services; two workers was the highest
  // stable full-suite level measured on the local 12-CPU, 8-GB Docker host.
  workers: process.env["CI"] === "true" ? "50%" : 2,
  retries: 0,
  projects: [
    {
      name: "desktop-chromium",
      testIgnore:
        /(dashboard-mobile|dashboard-navigation-mobile|phase-two-mobile|phase-three-mobile|apps-mobile|billing-mobile)\.spec\.ts/u,
      use: {
        ...devices["Desktop Chrome"],
        trace: "retain-on-failure",
      },
    },
    {
      name: "mobile-chromium",
      testMatch:
        /(dashboard-mobile|dashboard-navigation-mobile|apps-mobile|billing-mobile)\.spec\.ts/u,
      use: {
        ...devices["Pixel 7"],
        trace: "retain-on-failure",
      },
    },
  ],
});
