import { it, expect } from "vitest";
import { telegramOwnerDestination } from "./owner-destination.js";
it("uses the selected account's API root and reports only its public bot address", async () => {
  const urls: string[] = [];
  const request: typeof fetch = async (input) => {
    urls.push(String(input));
    return Response.json({ ok: true, result: { username: "fixture_bot" } });
  };
  expect(await telegramOwnerDestination("fixture:token", "http://127.0.0.1:16991", request)).toBe(
    "https://t.me/fixture_bot",
  );
  expect(urls).toEqual(["http://127.0.0.1:16991/botfixture%3Atoken/getMe"]);
});
it("does not expose credential-bearing errors or malformed destinations", async () => {
  expect(
    await telegramOwnerDestination("private", undefined, async () => {
      throw new Error("private URL");
    }),
  ).toBeUndefined();
  expect(
    await telegramOwnerDestination("private", undefined, async () =>
      Response.json({ ok: true, result: { username: "bad/path" } }),
    ),
  ).toBeUndefined();
});
