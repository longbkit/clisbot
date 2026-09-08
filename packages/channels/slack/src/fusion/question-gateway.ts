// Fusion-owned boundary for `openclaw/plugin-sdk/question-gateway-runtime`
// (D-032).
//
// Upstream resolves an `ask_user` choice by calling the OpenClaw Gateway
// (`question.get` / `question.resolve` RPCs) and registers the channel delivery
// so a later reaction or button press can be matched back to the question
// record. Fusion's Hub owns questions and their delivery ledger, and there is no
// Gateway in this process.
//
// The encode/decode half of `question-actions.ts` is pure and stays on the
// production path (the Slack button value envelope). The resolve half fails
// loudly rather than silently answering nothing; it lands with the interactive
// callback slice (goal ledger slice 21).

/** Upstream's resolve verdict. */
export type ResolveQuestionOverGatewayResult =
  | { status: "answered"; questionId: string; optionValue: string }
  | { status: "custom-input"; questionId: string }
  | { status: "already-terminal"; reason: "already-terminal" | "not-found" };

export type ResolveQuestionOverGatewayParams = {
  cfg: unknown;
  questionId: string;
  senderId?: string | null;
  optionIndex?: number;
  optionValue?: string;
  accountId?: string;
  [key: string]: unknown;
};

const NO_GATEWAY =
  "ask_user questions have no Hub seam yet: the Slack question resolver lands with the interactive callback slice.";

export const questionGatewayRuntime = {
  async resolveOption(
    _params: ResolveQuestionOverGatewayParams,
  ): Promise<ResolveQuestionOverGatewayResult> {
    throw new Error(NO_GATEWAY);
  },
  readAskUserQuestionId(payload: { channelData?: Record<string, unknown> }): string | undefined {
    const askUser = payload.channelData?.askUser;
    if (!askUser || typeof askUser !== "object" || Array.isArray(askUser)) {
      return undefined;
    }
    const questionId = (askUser as { questionId?: unknown }).questionId;
    return typeof questionId === "string" && questionId ? questionId : undefined;
  },
  registerChannelDelivery(_params: unknown): void {
    throw new Error(NO_GATEWAY);
  },
};
