# Agent-OS Tests

## Purpose

These test cases define the ground truth for the agent operating model in `muxbot`.

They cover durable concepts that must stay coherent even if the concrete runner changes.

## Current Coverage Truth

- Agent-OS persists session continuity metadata by `sessionKey`
- a later prompt can recreate a killed tmux runner and resume the same stored `sessionId` when the backend supports it
- stale tmux cleanup is implemented without forcing conversation reset
- reset policy is not implemented yet

## Test Case 1: Agent Identity And Session Key Stay Separate

### Preconditions

- an agent named `default` is defined in configuration
- no active conversation is currently using that agent

### Steps

1. Send one prompt through a configured channel to agent `default`
2. Send a second prompt in a different routed conversation that still maps to agent `default`
3. Inspect the runtime state

### Expected Results

- one stable agent identity owns both conversations
- each conversation resolves to its own session key
- the system does not need a second agent identity just to isolate conversation state

## Test Case 2: Agent Workspace Is Created And Reused Predictably

### Preconditions

- the workspace for agent `default` does not yet exist

### Steps

1. Start a new conversation with agent `default`
2. Inspect the workspace path after the first run
3. Send a second prompt to the same agent

### Expected Results

- a workspace is created for the agent at the configured root
- the same workspace is reused on later prompts and later session keys for that agent
- workspace ownership is tied to the agent or session model rather than to one incoming message

## Test Case 3: One Session Processes Prompts Serially

### Preconditions

- service is running

### Steps

1. Send two prompts to the same routed conversation in quick succession
2. Inspect the runtime state and visible channel output while both are pending

### Expected Results

- the second prompt waits behind the first
- overlapping work does not corrupt the session state
- queue position or busy state is scoped to the session key instead of the whole agent

## Test Case 4: Tools, Skills, And Subagents Are Scoped To The Agent

### Preconditions

- the agent has explicit tool, skill, or subagent configuration

### Steps

1. Start a run that uses the configured capability set
2. Inspect the active agent state during execution
3. Start a separate agent with a different capability set

### Expected Results

- tool, skill, and subagent availability is derived from the agent definition
- one agent does not silently inherit another agent's capability set
- the operating model stays stable even if the underlying runner implementation changes

## Test Case 4A: Different Session Keys For One Agent Do Not Share tmux Session Identity

### Preconditions

- one agent named `default` is routed from a Slack channel

### Steps

1. Send one top-level Slack mention in the routed channel
2. Send a second top-level Slack mention in the same routed channel
3. Inspect the tmux session list

### Expected Results

- both Slack interactions still resolve to the same `agentId`
- each top-level Slack interaction gets a different thread-backed session key
- tmux session names are distinct even though the workspace is shared

## Test Case 5: Control Slash Commands Take Priority Over Native Slash Commands

### Preconditions

- a conversation surface is routed to a live agent

### Steps

1. Send `/transcript`
2. Send `/stop`
3. Send an unknown slash command such as `/model`

### Expected Results

- reserved control slash commands are handled by muxbot before runner input forwarding
- `/transcript` returns the current full conversation session transcript
- `/stop` sends `Escape` to interrupt current processing in the current conversation session
- unknown slash commands are forwarded unchanged to the native agent CLI

## Test Case 6: Agent Bash Commands Run In The Agent Workspace Without Taking Over The Main CLI Pane

### Preconditions

- a conversation surface is routed to a live agent
- the underlying runner is tmux-backed

### Steps

1. Send `/bash pwd`
2. Send `!git diff`
3. Inspect the tmux session while the bash command runs if needed

### Expected Results

- `/bash` and `!` run in the current agent workspace
- the main agent CLI pane is not replaced by the bash command
- the bash command runs in one reusable shell surface tied to the same conversation session
- later bash commands reuse that same shell surface instead of creating a new tmux window each time
- command output is returned to the conversation after completion

## Test Case 7: Same Session Key Can Survive Runner Loss

### Status

Implemented

### Preconditions

- a routed conversation already has one active AI CLI-backed session
- the backend supports native resume by session id

### Steps

1. Send a prompt and wait until the conversation is clearly active
2. Kill the backing tmux session unexpectedly
3. Send another prompt to the same routed conversation
4. Inspect the recovered runtime state

### Expected Results

- the same `sessionKey` is reused
- the system creates a new runner instance instead of requiring the old tmux session to exist
- the runner resumes the previous active AI CLI `sessionId`
- the conversation continues without requiring a manual `/new`

## Test Case 7A: Agent-OS Persists Session Continuity Metadata By Session Key

### Status

Implemented

### Preconditions

- a routed conversation starts on a runner that exposes or accepts a stable AI CLI session id

### Steps

1. send the first prompt to a new `sessionKey`
2. inspect `session.storePath`
3. send another prompt on the same `sessionKey`

### Expected Results

- one entry is created for that `sessionKey`
- the entry stores `agentId`, `sessionKey`, `sessionId`, `workspacePath`, `runnerCommand`, and `updatedAt`
- the second prompt reuses the same stored `sessionId` unless reset policy explicitly rotates it

## Test Case 8: Runner Sunsetting Does Not Imply Conversation Reset

### Status

Implemented

### Preconditions

- one conversation has completed at least one interaction
- a runner idle-sunset policy is enabled

### Steps

1. Let the conversation stay idle until the tmux runner is sunset or evicted
2. Verify that the live tmux session is gone
3. Send a new prompt to the same routed conversation

### Expected Results

- the old tmux session does not stay alive forever
- the logical conversation still resolves to the same `sessionKey`
- the system can recreate a runner and resume the same active AI CLI `sessionId` when supported
- session reset only happens when reset policy says so, not merely because tmux resources were reclaimed
