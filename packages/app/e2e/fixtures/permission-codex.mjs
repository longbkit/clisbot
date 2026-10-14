import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import path from "node:path";

let cwd;
let turnId;
let rejectFirst = false;
let steers = 0;
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const record = (value) => {
  if (!cwd) throw new Error("Permission fixture has no session cwd");
  appendFileSync(path.join(cwd, "permission-fixture.jsonl"), JSON.stringify(value) + "\n");
};
function question(threadId, id, title) {
  send({
    method: "item/completed",
    params: {
      threadId,
      turnId,
      item: {
        type: "agentMessage",
        id,
        text: title,
        delivery: "async",
        questions: [{ title }],
      },
    },
  });
}
function respond(method, params) {
  switch (method) {
    case "initialize":
      return {};
    case "model/list":
      return { data: [{ id: "gpt-6.1-sol", model: "gpt-6.1-sol", isDefault: true }] };
    case "config/read":
      cwd = params.cwd ?? cwd;
      return { config: {} };
    case "collaborationMode/list":
    case "skills/list":
    case "thread/list":
    case "thread/loaded/list":
      return { data: [] };
    case "thread/start":
      cwd = params.cwd;
      return { thread: { id: randomUUID() } };
    case "thread/resume":
      cwd = params.cwd ?? cwd;
      return { thread: { id: params.threadId } };
    case "thread/read":
      return { thread: { id: params.threadId, turns: [] } };
    case "turn/start": {
      turnId = randomUUID();
      const prompt = JSON.stringify(params.input);
      rejectFirst = prompt.includes("reject-first");
      setTimeout(() => {
        send({
          method: "turn/started",
          params: { threadId: params.threadId, turn: { id: turnId } },
        });
        question(params.threadId, "question-main", "Please give a short status.");
        if (prompt.includes("two-questions"))
          question(params.threadId, "question-other", "Which action still needs authorization?");
      }, 50);
      return { turn: { id: turnId } };
    }
    case "turn/steer":
      steers++;
      record({ method, params, accepted: !(rejectFirst && steers === 1) });
      if (rejectFirst && steers === 1) {
        return { error: { code: -32600, message: "no active turn to steer" } };
      }
      return { turnId };
    case "turn/interrupt":
      setTimeout(() => {
        send({
          method: "turn/completed",
          params: { threadId: params.threadId, turn: { id: turnId, status: "interrupted" } },
        });
      }, 10);
      return {};
    default:
      throw new Error(`Unsupported permission fixture method: ${method}`);
  }
}

if (process.argv.includes("--version")) console.log("codex-cli 0.159.0");
else
  readline.createInterface({ input: process.stdin }).on("line", (line) => {
    const request = JSON.parse(line);
    if (request.id === undefined) return;
    try {
      const result = respond(request.method, request.params ?? {});
      send(result.error ? { id: request.id, error: result.error } : { id: request.id, result });
    } catch (error) {
      send({ id: request.id, error: { code: -32601, message: error.message } });
    }
  });
