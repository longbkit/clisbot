import { expect, test } from "vitest";
import type { QuickStartDestination } from "@/clisbot/quick-starts/model";
import { isQuickChatPath } from "@/clisbot/quick-chats/quick-chat-projects";
import { offersAsProject, orderStartOptions } from "./start-kinds";

const ROOT = "/home/me/.clisbot/quick-chats";

test("the Host's Quick chats folder and everything in it are Quick chats", () => {
  expect(isQuickChatPath(ROOT, ROOT)).toBe(true);
  expect(isQuickChatPath(`${ROOT}/2026-10-10-hello-a1b2c3d4`, ROOT)).toBe(true);
  expect(isQuickChatPath(`${ROOT}/`, `${ROOT}/`)).toBe(true);
  expect(isQuickChatPath("C:\\clisbot\\quick-chats\\x", "C:\\clisbot\\quick-chats")).toBe(true);
  // A user's own repo named quick-chats, or a sibling folder, stays a Project.
  expect(isQuickChatPath("/home/me/code/quick-chats", ROOT)).toBe(false);
  expect(isQuickChatPath(`${ROOT}-old`, ROOT)).toBe(false);
  expect(isQuickChatPath(`${ROOT}/x`, null)).toBe(false);
});

test("a Bot's home and the Quick chat folder are not offered as Projects", () => {
  const bots = new Set(["prj_bot"]);
  expect(offersAsProject("prj_repo", "/home/me/code/repo", bots, ROOT)).toBe(true);
  expect(offersAsProject("prj_bot", "/home/me/.clisbot/bots/helper", bots, ROOT)).toBe(false);
  expect(offersAsProject("prj_quick", ROOT, bots, ROOT)).toBe(false);
});

test("the picker opened from a mode lists that mode's group first", () => {
  const destination = (id: string, group: string) =>
    ({ option: { id, label: id, group } }) as QuickStartDestination;
  const destinations = [
    destination("quickChat", "Quick chat"),
    destination("repo", "Projects"),
    destination("bot:1", "Bots"),
  ];
  expect(orderStartOptions(destinations, "bot").map((option) => option.id)).toEqual([
    "bot:1",
    "quickChat",
    "repo",
  ]);
  expect(orderStartOptions(destinations, "project")[0].id).toBe("repo");
});
