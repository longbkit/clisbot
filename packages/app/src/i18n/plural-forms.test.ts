import { createInstance } from "i18next";
import { expect, it } from "vitest";
import { withPluralForms } from "./plural-forms";

const ru = { members_one: "{{count}} участник", members_other: "Участников: {{count}}" };
const ar = { members_one: "عضو واحد", members_other: "الأعضاء: {{count}}" };

it("Russian and Arabic counts beyond one use the locale's _other, not English", async () => {
  const i18n = createInstance();
  await i18n.init({
    fallbackLng: "en",
    resources: {
      en: { translation: { members_one: "{{count}} Member", members_other: "{{count}} Members" } },
      ru: { translation: withPluralForms("ru", ru) },
      ar: { translation: withPluralForms("ar", ar) },
    },
  });
  expect(i18n.t("members", { lng: "ru", count: 1 })).toBe("1 участник");
  expect(i18n.t("members", { lng: "ru", count: 3 })).toBe("Участников: 3");
  expect(i18n.t("members", { lng: "ru", count: 5 })).toBe("Участников: 5");
  for (const count of [0, 2, 3, 11, 100])
    expect(i18n.t("members", { lng: "ar", count })).toBe(`الأعضاء: ${count}`);
});

it("leaves other locales and existing forms untouched", () => {
  const fr = { a_one: "x", a_other: "y" };
  expect(withPluralForms("fr", fr)).toBe(fr);
  expect(withPluralForms("ru", { a_few: "own", a_other: "y" })).toEqual({
    a_few: "own",
    a_other: "y",
    a_many: "y",
  });
});
