import { compareMatchClasses, type MatchClass } from "@clisbot/protocol/search/text-match";
import {
  compareBuiltInScores,
  compareByRecency,
  scoreSearchFields,
  searchFieldsMatchClass,
  type CommandCenterScore,
  type CommandCenterSearchFields,
  type CommandCenterWorkspaceAgent,
  type CommandCenterWorkspaceResult,
} from "./results";

/** A change-request query: an optional `pr`/`mr` word, an optional `#`/`!`, a number. */
const CHANGE_REQUEST_QUERY = /^(?:(?:pr|mr)\s*)?[#!]?(\d+)$/i;

/**
 * Parse a change-request-shaped query into its number.
 *
 * Accepts `42`, `#42`, `!42`, `pr 42`, `pr42`, `PR #42`, `mr!42`, and so on.
 * Returns null for anything else, including text queries that merely contain
 * digits (`fix-42-retries`), so those fall through to normal text matching.
 */
function parseChangeRequestQuery(query: string): number | null {
  const match = CHANGE_REQUEST_QUERY.exec(query.trim());
  if (!match) return null;
  const number = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(number) ? number : null;
}

/** Within a match class, a match on the workspace's own text ranks ahead of one through an agent. */
const OWN_MATCH = 0;
const AGENT_MATCH = 1;
/** The host matched it (typo-tolerant, server-side) but nothing here does. Archived rows only. */
const HOST_MATCH = 2;

/** How a row matched: its class decides first, its score within the class. */
interface Candidate {
  matchClass: MatchClass;
  score: CommandCenterScore;
}

interface ScoredWorkspace {
  workspace: CommandCenterWorkspaceResult;
  via: typeof OWN_MATCH | typeof AGENT_MATCH | typeof HOST_MATCH;
  /** The match the row shows, which is also the one it ranks by. */
  candidate: Candidate | null;
  agent: CommandCenterWorkspaceAgent | null;
  changeRequestHit: boolean;
}

function ownSearchFields(workspace: CommandCenterWorkspaceResult) {
  return { visible: [workspace.title, workspace.subtitle], hidden: [] };
}

/** An agent is found through its own title and its workspace's text together. */
function agentSearchFields(
  workspace: CommandCenterWorkspaceResult,
  agent: CommandCenterWorkspaceAgent,
) {
  return { visible: [workspace.title, workspace.subtitle, agent.title], hidden: [] };
}

function scoreCandidate(query: string, fields: CommandCenterSearchFields): Candidate | null {
  const score = scoreSearchFields(query, fields);
  const matchClass = searchFieldsMatchClass(query, fields);
  return score && matchClass ? { matchClass, score } : null;
}

/**
 * Clisbot: the last query each row was scored for, with its result. Built rows never change in
 * place and an unchanged workspace keeps its object, so a directory update rescores only the rows
 * it replaced; with thousands of rows, rescoring every one took about half a second on a phone.
 */
const ownCandidates = new WeakMap<
  CommandCenterWorkspaceResult,
  { query: string; candidate: Candidate | null }
>();
const agentCandidates = new WeakMap<
  CommandCenterWorkspaceResult,
  { query: string; match: AgentMatch | null }
>();

function ownCandidate(query: string, workspace: CommandCenterWorkspaceResult): Candidate | null {
  const cached = ownCandidates.get(workspace);
  if (cached?.query === query) return cached.candidate;
  const candidate = scoreCandidate(query, ownSearchFields(workspace));
  ownCandidates.set(workspace, { query, candidate });
  return candidate;
}

function compareCandidates(left: Candidate, right: Candidate): number {
  return (
    compareMatchClasses(left.matchClass, right.matchClass) ||
    compareBuiltInScores(left.score, right.score)
  );
}

/**
 * Change-request hits first, host-only matches last; then match class, the workspace's own text
 * ahead of an agent, match quality, and recency.
 */
function compareScoredWorkspaces(left: ScoredWorkspace, right: ScoredWorkspace): number {
  if (left.changeRequestHit !== right.changeRequestHit) {
    return left.changeRequestHit ? -1 : 1;
  }
  if ((left.via === HOST_MATCH) !== (right.via === HOST_MATCH)) {
    return left.via === HOST_MATCH ? 1 : -1;
  }
  if (left.candidate && right.candidate) {
    const classDelta = compareMatchClasses(left.candidate.matchClass, right.candidate.matchClass);
    if (classDelta !== 0) return classDelta;
  }
  if (left.via !== right.via) return left.via - right.via;
  if (left.candidate && right.candidate) {
    const scoreDelta = compareBuiltInScores(left.candidate.score, right.candidate.score);
    if (scoreDelta !== 0) return scoreDelta;
  }
  return compareByRecency(left.workspace, right.workspace);
}

interface AgentMatch extends Candidate {
  agent: CommandCenterWorkspaceAgent;
}

/**
 * The workspace's best-matching agent. Each agent is scored together with the workspace's
 * text, so a query split across the two finds it. Agents arrive most recent first, so a tie
 * keeps the newer one.
 */
function agentMatch(workspace: CommandCenterWorkspaceResult, query: string): AgentMatch | null {
  const cached = agentCandidates.get(workspace);
  if (cached?.query === query) return cached.match;
  const match = bestAgentMatch(workspace, query);
  agentCandidates.set(workspace, { query, match });
  return match;
}

function bestAgentMatch(workspace: CommandCenterWorkspaceResult, query: string): AgentMatch | null {
  let best: AgentMatch | null = null;
  for (const agent of workspace.agents) {
    const candidate = scoreCandidate(query, agentSearchFields(workspace, agent));
    if (candidate && (!best || compareCandidates(candidate, best) < 0)) {
      best = { agent, ...candidate };
    }
  }
  return best;
}

export type WorkspaceRanker = (
  workspaces: readonly CommandCenterWorkspaceResult[],
  query: string,
  options?: { keepUnmatched?: boolean },
) => CommandCenterWorkspaceResult[];

/**
 * Rank workspaces for a query, best match first. A workspace matches on its own title, project,
 * branch and change request, or on those together with the title of one of its agents. It is
 * matched through an agent only when the agent matches in a closer class than its own text
 * (see `MatchClass`), never on a change-request hit; such a match comes back naming that agent,
 * and opens it. Each row ranks by the match it shows.
 *
 * An empty query lists every workspace, most recent first. `keepUnmatched` keeps rows nothing
 * here matches, ranked last: archived rows come from the host's own search, which is
 * typo-tolerant, so the host is the authority on whether they match.
 *
 * The ranker remembers the row it made for each workspace and agent, so a row matched through
 * the same agent is the same object on every keystroke and its list row does not re-render.
 */
export function createWorkspaceRanker(): WorkspaceRanker {
  const viaAgent = new WeakMap<
    CommandCenterWorkspaceResult,
    Map<string, CommandCenterWorkspaceResult>
  >();

  function matchedThrough(
    workspace: CommandCenterWorkspaceResult,
    agent: CommandCenterWorkspaceAgent,
  ): CommandCenterWorkspaceResult {
    let rows = viaAgent.get(workspace);
    if (!rows) {
      rows = new Map();
      viaAgent.set(workspace, rows);
    }
    let row = rows.get(agent.id);
    if (!row) {
      row = { ...workspace, matchedAgent: agent, run: () => workspace.openAgent(agent.id) };
      rows.set(agent.id, row);
    }
    return row;
  }

  return (workspaces, query, options = {}) => {
    if (!query.trim()) return [...workspaces].sort(compareByRecency);

    const changeRequestNumber = parseChangeRequestQuery(query);
    const matches: ScoredWorkspace[] = [];
    for (const workspace of workspaces) {
      const changeRequestHit =
        changeRequestNumber !== null && workspace.changeRequestNumber === changeRequestNumber;
      const own = ownCandidate(query, workspace);
      // A change-request hit is the workspace's own answer to the query.
      const throughAgent = changeRequestHit ? null : agentMatch(workspace, query);
      // An agent is named only when it matches in a closer class than the workspace's own text.
      if (
        throughAgent &&
        (!own || compareMatchClasses(throughAgent.matchClass, own.matchClass) < 0)
      ) {
        matches.push({
          workspace,
          via: AGENT_MATCH,
          candidate: throughAgent,
          agent: throughAgent.agent,
          changeRequestHit,
        });
      } else if (own || changeRequestHit) {
        matches.push({ workspace, via: OWN_MATCH, candidate: own, agent: null, changeRequestHit });
      } else if (options.keepUnmatched) {
        matches.push({
          workspace,
          via: HOST_MATCH,
          candidate: null,
          agent: null,
          changeRequestHit,
        });
      }
    }
    matches.sort(compareScoredWorkspaces);
    return matches.map((match) =>
      match.agent ? matchedThrough(match.workspace, match.agent) : match.workspace,
    );
  };
}

const defaultWorkspaceRanker = createWorkspaceRanker();

/** COMPAT(clisbot): the pre-v0.17.4 ranking entry point, for callers that rank without a ranker. */
export function filterAndRankWorkspaces(
  workspaces: readonly CommandCenterWorkspaceResult[],
  query: string,
): CommandCenterWorkspaceResult[] {
  return defaultWorkspaceRanker(workspaces, query);
}
