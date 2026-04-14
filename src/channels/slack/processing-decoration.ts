export type SlackProcessingDecorationPhase =
  | "add-reaction"
  | "set-status"
  | "remove-reaction"
  | "clear-status";

export async function activateSlackProcessingDecoration(params: {
  addReaction: () => Promise<boolean>;
  removeReaction: () => Promise<boolean>;
  setStatus: () => Promise<boolean>;
  clearStatus: () => Promise<boolean>;
  onUnexpectedError?: (phase: SlackProcessingDecorationPhase, error: unknown) => void;
}) {
  const [reactionResult, statusResult] = await Promise.allSettled([
    params.addReaction(),
    params.setStatus(),
  ]);

  const reactionApplied =
    reactionResult.status === "fulfilled" ? reactionResult.value === true : false;
  const statusApplied =
    statusResult.status === "fulfilled" ? statusResult.value === true : false;

  if (reactionResult.status === "rejected") {
    params.onUnexpectedError?.("add-reaction", reactionResult.reason);
  }
  if (statusResult.status === "rejected") {
    params.onUnexpectedError?.("set-status", statusResult.reason);
  }

  if (!reactionApplied && !statusApplied) {
    if (reactionResult.status === "rejected") {
      throw reactionResult.reason;
    }
    if (statusResult.status === "rejected") {
      throw statusResult.reason;
    }
  }

  return async () => {
    if (reactionApplied) {
      try {
        await params.removeReaction();
      } catch (error) {
        params.onUnexpectedError?.("remove-reaction", error);
      }
    }

    if (statusApplied) {
      try {
        await params.clearStatus();
      } catch (error) {
        params.onUnexpectedError?.("clear-status", error);
      }
    }
  };
}
