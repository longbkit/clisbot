import { ChevronRight } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { skillOffKey, skillsInOffList } from "@clisbot/protocol/connectors/types";
import { SettingsSection } from "@/components/settings";
import { useAgentCommandsQuery, type AgentSlashCommand } from "@/hooks/use-agent-commands-query";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import { AgentToolGroupIcon } from "./agent-tools-section";
import { toggled, type SessionOffEdit } from "./session-connectors";
import { SessionSwitchRow } from "./session-switch-row";

/**
 * The skills a running session can load, as its provider reports them (Claude, Codex and OpenCode
 * tell skills from commands). A provider that can hide one skill for a session (Claude, through
 * `skillOverrides`) gets a switch per skill; for the others the list only shows
 * (docs/features/connectors/README.md, "Per session").
 */

export const SKILLS_PAGE = "skills";

const ThemedChevron = withUnistyles(ChevronRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

export interface SessionSkills {
  /** Null in a draft: the provider lists skills for a session that exists. */
  skills: AgentSlashCommand[] | null;
  loading: boolean;
  /** Whether the session's provider can switch single skills. */
  switchable: boolean;
}

/** Descriptions seen while a skill was listed, for when it is off and Claude no longer lists it. */
const seenDescriptions = new Map<string, string>();

/** A skill turned off may drop out of the provider's list; it stays listed so it can come back. */
function withSkillsOff(skills: AgentSlashCommand[], off: ReadonlySet<string>) {
  for (const skill of skills) seenDescriptions.set(skill.name, skill.description);
  const listed = new Set(skills.map((skill) => skill.name));
  const missing = skillsInOffList(off)
    .filter((name) => !listed.has(name))
    .map((name) => ({
      name,
      description: seenDescriptions.get(name) ?? "",
      argumentHint: "",
      kind: "skill",
    }));
  return [...skills, ...missing].sort((a, b) => a.name.localeCompare(b.name));
}

export function useSessionSkills(
  serverId: string,
  agentId: string | null,
  off: ReadonlySet<string>,
): SessionSkills {
  const query = useAgentCommandsQuery({ serverId, agentId: agentId ?? "", enabled: !!agentId });
  const switchable = useSessionStore((state) =>
    agentId
      ? Boolean(state.sessions[serverId]?.agents?.get(agentId)?.capabilities?.supportsSkillToggles)
      : false,
  );
  const skills = useMemo(
    () =>
      withSkillsOff(
        query.commands.filter((command) => command.kind === "skill"),
        off,
      ),
    [off, query.commands],
  );
  if (!agentId) return { skills: null, loading: false, switchable: false };
  return { skills, loading: query.isLoading, switchable };
}

function skillsSummary({ skills, loading }: SessionSkills, off: ReadonlySet<string>): string {
  if (skills === null) return "Listed once the session starts";
  if (loading) return "Loading…";
  if (skills.length === 0) return "None found";
  const count = skills.length === 1 ? "1 skill" : `${skills.length} skills`;
  const offCount = skills.filter((skill) => off.has(skillOffKey(skill.name))).length;
  return offCount > 0 ? `${count} · ${offCount} off here` : count;
}

/** One row for the session's skills; it opens their list. */
export function SkillsSection({
  skills,
  off,
  onOpen,
}: {
  skills: SessionSkills;
  off: ReadonlySet<string>;
  onOpen(page: string): void;
}) {
  const listed = (skills.skills?.length ?? 0) > 0;
  const open = useCallback(() => onOpen(SKILLS_PAGE), [onOpen]);
  const summary = skillsSummary(skills, off);
  return (
    <SettingsSection title="Skills">
      <View style={settingsStyles.card}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Skills, ${summary}`}
          disabled={!listed}
          onPress={open}
          style={rowStyle}
          testID="session-tools-skills"
        >
          <AgentToolGroupIcon group={SKILLS_PAGE} dimmed={!listed} />
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Skills</Text>
            <Text style={settingsStyles.rowHint}>{summary}</Text>
          </View>
          {listed ? <ThemedChevron size={ICON_SIZE.sm} /> : null}
        </Pressable>
      </View>
    </SettingsSection>
  );
}

function rowStyle({ hovered }: { hovered?: boolean }) {
  return [styles.row, hovered ? styles.hovered : null];
}

/** Every skill by its name and what it is for, narrowed by the header's search. */
export function SkillsPage({
  skills,
  query,
  off,
  apply,
}: {
  skills: SessionSkills;
  query: string;
  off: ReadonlySet<string>;
  apply(edit: SessionOffEdit): void;
}) {
  const shown = useMemo(() => matchingSkills(skills.skills ?? [], query), [query, skills.skills]);
  const toggle = useCallback(
    (name: string) => apply((current) => toggled(current, skillOffKey(name))),
    [apply],
  );
  if (shown.length === 0) {
    return <Text style={[settingsStyles.rowHint, styles.empty]}>No skill matches.</Text>;
  }
  return (
    <View style={settingsStyles.card}>
      {shown.map((skill, index) => (
        <SessionSwitchRow
          key={skill.name}
          id={skill.name}
          bordered={index > 0}
          value={!off.has(skillOffKey(skill.name))}
          onToggle={skills.switchable ? toggle : undefined}
          label={skill.name}
          testID={`session-skill-${skill.name}`}
        >
          <Text style={styles.name}>{`/${skill.name}`}</Text>
          {skill.description ? (
            <Text style={settingsStyles.rowHint} numberOfLines={2}>
              {skill.description}
            </Text>
          ) : null}
        </SessionSwitchRow>
      ))}
    </View>
  );
}

function matchingSkills(skills: readonly AgentSlashCommand[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return skills;
  return skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle),
  );
}

export const SKILLS_PAGE_HEADER = {
  title: "Skills",
  subtitle: "What this agent can load when a task needs it",
};

export function skillsInfo(switchable: boolean): string {
  const source =
    "Skills come from the agent's own folders on the Host, such as ~/.claude/skills or the project's .claude/skills.";
  return switchable
    ? `${source} A skill turned off here cannot be loaded from the agent's next step, and other sessions keep it.`
    : `${source} This agent's provider cannot turn single skills off for one session.`;
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
  hovered: { backgroundColor: theme.colors.surface1 },
  empty: { padding: theme.spacing[3] },
  name: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
}));
