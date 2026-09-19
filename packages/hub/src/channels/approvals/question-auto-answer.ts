// How an agent's question (AskUserQuestion, `kind: "question"`) is handled,
// per the Route's `questions:` default (`QuestionsModeSchema`). A question is
// never auto-allowed with an empty answer: the agent would continue with
// nothing. It is not a permission either: the approval rules do not apply. Answers are keyed by the FULL question text, the same shape a
// channel answer uses (`buildResponse` in `index.ts`).
import type { QuestionsMode } from "../config/enums.js";
import type { AgentPermissionRequest, AgentPermissionResponse } from "../daemon/types.js";
import { questionInfoFromRequest, type QuestionInfo } from "./card.js";

/** The deny message `agent-decides` sends: the agent reads it as the answer. */
export const AGENT_DECIDES_MESSAGE =
  "Nobody is available to answer questions in this conversation. Decide yourself: " +
  "choose the option you recommend and continue.";

export type QuestionHandling =
  | { kind: "prompt" }
  | {
      kind: "answer";
      response: AgentPermissionResponse;
      answeredBy: "recommended" | "agent-decides";
    };

/**
 * What to do with a question. A question is not a permission, so the Route's
 * approval rules never decide it; absent `questions:` means `ask`.
 */
export function questionHandling(
  request: AgentPermissionRequest,
  mode: QuestionsMode = "ask",
): QuestionHandling {
  if (mode === "ask") return { kind: "prompt" };
  const answers = mode === "recommended" ? recommendedAnswers(request) : undefined;
  if (answers !== undefined) {
    const response = { behavior: "allow" as const, updatedInput: { answers } };
    return { kind: "answer", response, answeredBy: "recommended" };
  }
  const response = { behavior: "deny" as const, message: AGENT_DECIDES_MESSAGE };
  return { kind: "answer", response, answeredBy: "agent-decides" };
}

/** Each question's recommended option, keyed by the full question text.
 * Undefined when the request carries no question the parser could read. */
function recommendedAnswers(request: AgentPermissionRequest): Record<string, string> | undefined {
  const questions = questionInfoFromRequest(request);
  const raw = request.input?.["questions"];
  // The parser drops a malformed question; answering only the rest would send
  // a partial answer, so a dropped one means no automatic answer at all.
  if (questions === undefined || !Array.isArray(raw) || raw.length !== questions.length) {
    return undefined;
  }
  const answers: Record<string, string> = {};
  for (const question of questions) answers[question.text] = recommendedLabel(question);
  return answers;
}

/** The label of the option that says "recommended" (any case), else the first
 * (the parser keeps only questions with at least one option). */
function recommendedLabel(question: QuestionInfo): string {
  const recommended = question.options.find(({ label }) => /recommended/iu.test(label));
  return (recommended ?? question.options[0]!).label;
}
