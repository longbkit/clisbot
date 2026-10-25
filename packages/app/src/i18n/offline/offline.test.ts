import { afterEach, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { offlineT } from "./index";
import { offlineResources } from "./resources";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === "object" ? keys(child, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

it("defines every English key in Vietnamese", () => {
  expect(keys(offlineResources.vi!).sort()).toEqual(keys(offlineResources.en!).sort());
});

it("translates in the current language and falls back to English elsewhere", async () => {
  const values = { source: "build-03", hub: "Company" };
  expect(offlineT("source.hubUnreachable", values)).toBe(
    "build-03: Company is unreachable. If it is reached over a VPN, check that connection.",
  );
  await i18n.changeLanguage("vi");
  expect(offlineT("source.hubSignIn", values)).toBe("build-03: hãy đăng nhập lại Company.");
  await i18n.changeLanguage("fr");
  expect(offlineT("hub.timedOut", { seconds: 15 })).toBe("The Hub did not answer within 15 s");
});
