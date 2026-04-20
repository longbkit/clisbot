export type RuntimeMonitorRestartStage = {
  delayMinutes: number;
  maxRestarts: number;
};

export type RuntimeMonitorRestartBackoff = {
  fastRetry: {
    delaySeconds: number;
    maxRestarts: number;
  };
  stages: RuntimeMonitorRestartStage[];
};

export type RuntimeMonitorRestartPlan = {
  mode: "fast-retry" | "backoff";
  stageIndex: number;
  delayMs: number;
  restartAttemptInStage: number;
  restartsRemaining: number;
  totalConfiguredRestarts: number;
  stageMaxRestarts: number;
  repeatingFinalStage: boolean;
};

const LEGACY_DEFAULT_RUNTIME_MONITOR_RESTART_BACKOFF: RuntimeMonitorRestartBackoff = {
  fastRetry: {
    delaySeconds: 10,
    maxRestarts: 3,
  },
  stages: [
    {
      delayMinutes: 15,
      maxRestarts: 4,
    },
    {
      delayMinutes: 30,
      maxRestarts: 4,
    },
  ],
};

const DEFAULT_RUNTIME_MONITOR_RESTART_BACKOFF: RuntimeMonitorRestartBackoff = {
  fastRetry: {
    delaySeconds: 10,
    maxRestarts: 3,
  },
  stages: [
    {
      delayMinutes: 1,
      maxRestarts: 2,
    },
    {
      delayMinutes: 3,
      maxRestarts: 2,
    },
    {
      delayMinutes: 5,
      maxRestarts: 2,
    },
    {
      delayMinutes: 10,
      maxRestarts: 3,
    },
    {
      delayMinutes: 15,
      maxRestarts: 4,
    },
    {
      delayMinutes: 30,
      maxRestarts: 4,
    },
  ],
};

export const RUNTIME_MONITOR_RESTART_RESET_AFTER_MS = 15 * 60_000;

function cloneRestartBackoff(
  restartBackoff: RuntimeMonitorRestartBackoff,
): RuntimeMonitorRestartBackoff {
  return {
    fastRetry: {
      ...restartBackoff.fastRetry,
    },
    stages: restartBackoff.stages.map((stage) => ({
      ...stage,
    })),
  };
}

function matchesRestartBackoffShape(
  left: RuntimeMonitorRestartBackoff,
  right: RuntimeMonitorRestartBackoff,
) {
  if (
    left.fastRetry.delaySeconds !== right.fastRetry.delaySeconds ||
    left.fastRetry.maxRestarts !== right.fastRetry.maxRestarts ||
    left.stages.length !== right.stages.length
  ) {
    return false;
  }

  return left.stages.every((stage, index) => {
    const other = right.stages[index];
    return (
      other != null &&
      stage.delayMinutes === other.delayMinutes &&
      stage.maxRestarts === other.maxRestarts
    );
  });
}

export function getDefaultRuntimeMonitorRestartBackoff() {
  return cloneRestartBackoff(DEFAULT_RUNTIME_MONITOR_RESTART_BACKOFF);
}

export function normalizeRuntimeMonitorRestartBackoff(
  restartBackoff: RuntimeMonitorRestartBackoff,
) {
  if (
    matchesRestartBackoffShape(
      restartBackoff,
      LEGACY_DEFAULT_RUNTIME_MONITOR_RESTART_BACKOFF,
    )
  ) {
    return getDefaultRuntimeMonitorRestartBackoff();
  }

  return cloneRestartBackoff(restartBackoff);
}

export function getConfiguredRuntimeMonitorRestartBudget(
  restartBackoff: RuntimeMonitorRestartBackoff,
) {
  const normalized = normalizeRuntimeMonitorRestartBackoff(restartBackoff);
  return (
    normalized.fastRetry.maxRestarts +
    normalized.stages.reduce((sum, stage) => sum + stage.maxRestarts, 0)
  );
}

export function getRuntimeMonitorRestartPlan(
  restartBackoff: RuntimeMonitorRestartBackoff,
  restartNumber: number,
): RuntimeMonitorRestartPlan | null {
  const normalized = normalizeRuntimeMonitorRestartBackoff(restartBackoff);
  const totalConfiguredRestarts = getConfiguredRuntimeMonitorRestartBudget(normalized);
  const fastRetryMaxRestarts = normalized.fastRetry.maxRestarts;

  if (restartNumber >= 1 && restartNumber <= fastRetryMaxRestarts) {
    return {
      mode: "fast-retry",
      stageIndex: -1,
      delayMs: normalized.fastRetry.delaySeconds * 1000,
      restartAttemptInStage: restartNumber,
      restartsRemaining: Math.max(0, totalConfiguredRestarts - restartNumber),
      totalConfiguredRestarts,
      stageMaxRestarts: fastRetryMaxRestarts,
      repeatingFinalStage: false,
    };
  }

  let completedRestarts = fastRetryMaxRestarts;
  for (let index = 0; index < normalized.stages.length; index += 1) {
    const stage = normalized.stages[index]!;
    const stageStart = completedRestarts + 1;
    const stageEnd = completedRestarts + stage.maxRestarts;
    if (restartNumber >= stageStart && restartNumber <= stageEnd) {
      return {
        mode: "backoff",
        stageIndex: index,
        delayMs: stage.delayMinutes * 60_000,
        restartAttemptInStage: restartNumber - completedRestarts,
        restartsRemaining: Math.max(0, totalConfiguredRestarts - restartNumber),
        totalConfiguredRestarts,
        stageMaxRestarts: stage.maxRestarts,
        repeatingFinalStage: false,
      };
    }
    completedRestarts = stageEnd;
  }

  const finalStage = normalized.stages.at(-1);
  if (!finalStage) {
    return null;
  }

  return {
    mode: "backoff",
    stageIndex: normalized.stages.length - 1,
    delayMs: finalStage.delayMinutes * 60_000,
    restartAttemptInStage: Math.max(1, restartNumber - completedRestarts),
    restartsRemaining: 0,
    totalConfiguredRestarts,
    stageMaxRestarts: finalStage.maxRestarts,
    repeatingFinalStage: true,
  };
}
