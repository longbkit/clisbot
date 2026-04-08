export function resolveConfigDurationMs(params: {
  seconds?: number;
  minutes?: number;
  defaultMinutes: number;
}) {
  if (typeof params.seconds === "number" && Number.isFinite(params.seconds)) {
    return params.seconds * 1000;
  }

  if (typeof params.minutes === "number" && Number.isFinite(params.minutes)) {
    return params.minutes * 60_000;
  }

  return params.defaultMinutes * 60_000;
}
