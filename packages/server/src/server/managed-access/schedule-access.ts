import type {
  ScheduleTarget,
  StoredSchedule,
  UpdateScheduleNewAgentConfig,
} from "@clisbot/protocol/schedule/types";
import type { SessionInboundMessage } from "../messages.js";
import type { ProjectPrivilege } from "./types.js";

/**
 * Narrows `schedule/*` for a Project-scoped session: every schedule belongs to the Project of the
 * session it runs in (heartbeat) or of its working directory and workspace (schedule), and the
 * caller needs `schedule.manage` there. The session-wide `automation.manage` the lease carries
 * only gets the request this far (docs/audits/2026-10-06-conversation-schedules.md).
 *
 * Seeing a schedule needs only that. Anything that makes it run (create, update, resume, run
 * now) also needs what running it does: a launch the caller could start themselves (`new-agent`),
 * or `agent.interact` on the session and sending in its Chat (heartbeat). A run is unattended, so
 * a schedule must never widen what the caller can launch.
 */
export const SCHEDULE_PRIVILEGE: ProjectPrivilege = "schedule.manage";

export type NewAgentScheduleConfig = Extract<ScheduleTarget, { type: "new-agent" }>["config"];

export interface ScheduleAccessResolver {
  allowsAgent(agentId: string, privilege: ProjectPrivilege): Promise<boolean>;
  allowsCwd(cwd: string, privilege: ProjectPrivilege): Promise<boolean>;
  allowsWorkspace(workspaceId: string, privilege: ProjectPrivilege): Promise<boolean>;
  /** The caller may post in this Chat: it is theirs and they may talk to every Bot in it. */
  allowsChatSend(chatId: string): boolean;
  /** The caller could launch an agent with this configuration (`create_agent`'s check). */
  allowsLaunch(config: NewAgentScheduleConfig): Promise<boolean>;
  findSchedule(scheduleId: string): Promise<StoredSchedule | null>;
}

type CreateTarget = Extract<SessionInboundMessage, { type: "schedule/create" }>["target"];

/** May see and stop the schedule: `schedule.manage` where it runs. */
export async function allowsScheduleTarget(
  target: ScheduleTarget | CreateTarget,
  resolver: ScheduleAccessResolver,
): Promise<boolean> {
  if (target.type !== "new-agent") {
    return resolver.allowsAgent(target.agentId, SCHEDULE_PRIVILEGE);
  }
  const { cwd, workspaceId } = target.config;
  if (
    workspaceId !== undefined &&
    !(await resolver.allowsWorkspace(workspaceId, SCHEDULE_PRIVILEGE))
  ) {
    return false;
  }
  return resolver.allowsCwd(cwd, SCHEDULE_PRIVILEGE);
}

/** May make the schedule run: seeing it, plus everything a run does on the caller's behalf. */
export async function allowsScheduleRun(
  target: ScheduleTarget | CreateTarget,
  resolver: ScheduleAccessResolver,
): Promise<boolean> {
  if (!(await allowsScheduleTarget(target, resolver))) return false;
  if (target.type === "new-agent") return resolver.allowsLaunch(target.config);
  if (!(await resolver.allowsAgent(target.agentId, "agent.interact"))) return false;
  const chatId = "chatId" in target ? target.chatId : undefined;
  return chatId === undefined || resolver.allowsChatSend(chatId);
}

/**
 * Settles `schedule/*` and `loop/*` requests, or returns undefined for any other message. Loops
 * were removed upstream; their stubs still need `automation.manage`, so a scoped session is refused.
 */
export async function allowsScheduleInbound(
  message: SessionInboundMessage,
  resolver: ScheduleAccessResolver,
): Promise<boolean | undefined> {
  if (message.type.startsWith("loop/")) return false;
  if (!message.type.startsWith("schedule/")) return undefined;
  switch (message.type) {
    case "schedule/list":
      // Answered per item by `filterVisibleSchedules`.
      return true;
    case "schedule/create":
      return allowsScheduleRun(message.target, resolver);
    case "schedule/update": {
      const schedule = await resolver.findSchedule(message.scheduleId);
      if (!schedule) return false;
      return allowsScheduleRun(updatedTarget(schedule.target, message.newAgentConfig), resolver);
    }
    case "schedule/resume":
    case "schedule/run-once": {
      const schedule = await resolver.findSchedule(message.scheduleId);
      return schedule !== null && allowsScheduleRun(schedule.target, resolver);
    }
    case "schedule/inspect":
    case "schedule/logs":
    case "schedule/pause":
    case "schedule/delete": {
      const schedule = await resolver.findSchedule(message.scheduleId);
      return schedule !== null && allowsScheduleTarget(schedule.target, resolver);
    }
    default:
      return false;
  }
}

/** The target an update leaves behind, so the check covers the schedule as it will run. */
function updatedTarget(
  target: ScheduleTarget,
  patch: UpdateScheduleNewAgentConfig | undefined,
): ScheduleTarget {
  if (target.type !== "new-agent" || !patch) return target;
  const { workspaceId, model, modeId, thinkingOptionId, ...rest } = patch;
  const config: NewAgentScheduleConfig = { ...target.config, ...rest };
  const nullable = { workspaceId, model, modeId, thinkingOptionId };
  for (const [key, value] of Object.entries(nullable)) {
    if (value === null) delete (config as Record<string, unknown>)[key];
    else if (value !== undefined) (config as Record<string, unknown>)[key] = value;
  }
  return { ...target, config };
}

export async function filterVisibleSchedules<T extends { target: ScheduleTarget }>(
  schedules: readonly T[],
  resolver: ScheduleAccessResolver,
): Promise<T[]> {
  const allowed = await Promise.all(
    schedules.map((schedule) => allowsScheduleTarget(schedule.target, resolver)),
  );
  return schedules.filter((_, index) => allowed[index]);
}
