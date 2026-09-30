# Terminal profiles and Project creation

Status: decided 2026-09-25 and 2026-09-26; built 2026-09-26 except what [Not built yet](#not-built-yet) lists. What to watch before deciding more is at the end.

Two gaps push people to Full access today. The only way to let someone run an agent CLI in a terminal is a full shell (`terminal.use`). The only way to let someone add a Project is `workspace.manage`, which also deletes Projects, removes worktrees from disk, and always carries Can share.

## Why

- A Terminal profile launches an agent CLI directly. The PTY runs the command with no shell around it (`createTerminal` in `packages/server/src/terminal/terminal.ts`), and the terminal closes when the CLI exits. A shell reads every file the daemon user can read, secrets included.
- Profiles are not a permission boundary today. The app resolves the profile and sends `command`/`args` in `create_terminal_request`, and the daemon checks only `terminal.use`. Anyone allowed a profile could send `bash`.
- What a profile does not stop: shell escapes inside the CLI (Claude Code's `!` bash mode), and tool prompts inside the TUI, which the person at the keyboard answers. Clisbot's `approval.*` privileges do not apply there. A Developer can also run commands through a chat agent with `approval.command`, and can start a workspace script or a worktree setup command, which runs in a shell with only `project.use` or `workspace.create` (open decision below). Keeping secrets from a user needs OS-level isolation ([Later phases](README.md#later-phases)). Splitting the privileges removes the shell that runs without an AI in between and narrows what a mistake reaches.

## Terminal and Terminal profiles

| Privilege              | UI                | Grants                                                                    | Constraint                                                  |
| ---------------------- | ----------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `terminal.use`         | Terminal          | A shell running any command                                               | —                                                           |
| `terminal.profile.use` | Terminal profiles | Launch only the listed Terminal profiles; the daemon resolves the command | `terminalProfiles: "*" \| string[]` (profile ids), required |

|                   | Office worker | Developer                 | Full access               | Administrator |
| ----------------- | :-----------: | ------------------------- | ------------------------- | :-----------: |
| Terminal profiles |       —       | ✅ (choose which)         | ✅ (choose which)         |      ✅       |
| Terminal          |       —       | Off by default; can be on | On by default; can be off |      ✅       |

**Terminal** is a switch on the grant, like Can share: the level sets the default, the grant can change it. Turning it on shows a warning that a shell reads every file the daemon can, secrets included. With Terminal on, the profile list reads "All profiles (included with Terminal)", because a shell launches any of them.

- Office worker gets no profiles. Inside the TUI the user answers every tool prompt, which equals a Developer's approval power for that CLI.
- A new grant starts with every profile when the grantor may pass them all on, and with none when the grantor holds only some.
- Both privileges can be granted on a Host and on a Project. `terminalProfiles` from every applicable grant combine by union, and `"*"` covers every profile: the same rule as Agent configurations.
- Stored grants are migrated by Hub migration `0085_terminal_profile_grants.sql`: every grant with `terminal.use` gains `terminal.profile.use` and `terminalProfiles: "*"`, then grants holding neither `workspace.manage` nor `daemon.manage` lose `terminal.use`. A Developer who used the shell loses it at once; no access event is written.
- Grant at most what you hold: holding only `terminal.profile.use` never lets you grant `terminal.use`, and you grant only profiles you hold (`packages/hub/src/access/grantor.ts`).

### Launch

- `create_terminal_request` gains optional `profileId` and `prompt`. A separate launch RPC was rejected: it adds schemas to `messages.ts`, entries to the exhaustive map in `operation-permissions.ts`, and a second terminal-creation path, while the app call sites change either way.
- The app always sends `profileId` together with `command`/`args`, with no feature flag. A daemon that predates `profileId` ignores it and runs `command` as today. A user holding only `terminal.profile.use` never reaches such a daemon: the per-Project privilege enum in the ticket is strict, so an old daemon rejects the whole ticket. Tag the kept `command`/`args` `COMPAT(terminalProfileLaunch)`.
- With `profileId`, the daemon resolves the command from its own `terminalProfiles` for every session and ignores the client's `command`/`args`. An unknown `profileId` is an error, never a fallback to `command`; otherwise a made-up id plus `command: "bash"` opens a shell.
- Without `profileId`, the request needs `terminal.use`, as today.
- A profile launch never falls back to a shell: a profile that resolves to an empty command is refused (`resolveProfileLaunch` in `terminal-profile-session.ts`).
- For a restricted session a prompt stays an argument. A profile whose `command` is the prompt slot is refused, since the prompt would pick the program (`bash`). A prompt starting with `-` gets a leading space, since the CLI's option parser would read it as a flag (`--dangerously-skip-permissions`). Both apply only under Managed Access, so ordinary Clisbot launches exactly as before.
- Both the `cwd`'s Project and the `workspaceId`'s Project must allow the launch: the PTY starts in the one and belongs to the other.

### Using a running terminal

- Each terminal records how it was launched (`profileId`, absent for a shell) and who created it (`terminal-launches.ts`, in memory, dropped when the terminal exits). A terminal with no record counts as a shell, so a lost record fails closed. The creator decides nothing yet; it is stored so an owner-only rule can be added later.
- A profile terminal is shared within the workspace like every terminal today: anyone holding that profile in the Project can attach, type, and answer the CLI's prompts.
- The rule is per terminal. `allowsTerminal`/`allowsTerminalSync` in `resource-authorizer.ts` apply it, so every operation on a terminal id (subscribe, input, capture, kill, rename, close items) and every stream frame follows it:
  - a shell needs `terminal.use`;
  - profile P needs `terminal.use`, or `terminal.profile.use` with P granted.
- Lists (`list_terminals`, `subscribe_terminals`, `terminals_changed`) admit `terminal.profile.use` and filter each terminal with the same rule (`filterAuthorizedTerminals` in `terminal-session-controller.ts` checks the workspace, then the terminal). A terminal title comes from the running command and can carry a secret, so a terminal you cannot use is absent from the list, not shown locked.
- Accepted: a workspace row may show running because of a terminal you cannot see (terminal contributions in `workspace-directory.ts`). It discloses activity, not content.

### Profile list

- New `terminal.profile.list.request`, allowed with `terminal.use` or `terminal.profile.use` on any Project. A restricted session cannot read `get_daemon_config`, so today the app falls back to `DEFAULT_TERMINAL_PROFILES` and shows profiles the Host may not have.
- A session without `terminal.use` gets only its granted profiles, in the usual `TerminalProfile` shape with `command` emptied and `args` reduced to the prompt slot, never the real command or args, which can carry secrets. The daemon fills `icon` from the command, so the app's `getTerminalProfileIcon` and `profileTakesPrompt` keep working unchanged (`launchableTerminalProfiles` in `terminal-access.ts`). The command preview beside the name in the launch menu shows nothing for these users.
- The daemon advertises `server_info.features.terminalProfileGrants`. The app asks it per Project (`useLaunchableTerminalProfiles`); any other daemon has no Terminal grants, so the app keeps reading its config as before. With neither `terminal.use` nor `terminal.profile.use`, the menus show no terminal rows at all.

### Clisbot tools inside agents

- Every agent gets the Clisbot MCP tools by default: `mcp.enabled` and `mcp.injectIntoAgents` default to true (`packages/server/src/server/bootstrap.ts`), and the per-provider `clisbotTools` policy (`clisbot-tool-policy.ts`) decides the rest. Managed Access is not consulted.
- Five of them drive terminals: `list_terminals`, `create_terminal`, `kill_terminal`, `capture_terminal`, `send_terminal_keys`. An agent uses them to start a dev server or watcher in a terminal you can open, read its output later, or drive a REPL.
- Upstream they are not scoped: `list_terminals` with `all: true` lists every terminal on the daemon, and `capture_terminal`/`send_terminal_keys` accept any terminal id (`packages/server/src/server/agent/tools/clisbot-tools.ts`). Each call is an `approval.other` prompt, which Developer holds, so a Developer's agent could read and type into shells in Projects the Developer cannot open.
- Not changed yet: whether to limit these tools to the agent's own Project is [open decision 3](#open-decisions).
- Otherwise the tools stay on, also for a creator without Terminal. A shell the agent opens is hidden from that user's lists, and driving it gives the agent no more than its own shell tool, which needs `approval.command`; every level holding `approval.other` holds that too. The user still reads the output in the agent's answer. See [Watch](#watch-before-deciding-more).

## Project creation

### Options considered

| Option                                                                         | Precedent                                                                      | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keep `workspace.manage` as the only creator and add a Host folder policy**   | Today's model; GitLab "Allowed to create projects" for where the setting lives | **Chosen.** No new privilege. Limits where Full access creates. A Developer who must create gets Full access, with Terminal off if the shell is not wanted                                                                                                                                                                                                                                                                        |
| A `workspace.manage` switch on Developer grants                                | Can share                                                                      | Same result as picking Full access: Developer plus `workspace.manage` is exactly the Full access privilege set, so the grant row shows Full access, and `workspace.manage` implies Can share (`impliedPrivileges` in `packages/hub/src/access/contract.ts`). Two controls for one fact                                                                                                                                            |
| A separate `project.create` leaf, **Create Projects** switch                   | GitHub "Members can create repositories"; this repo's `workspace.create`       | Later, only if someone must create Projects without being able to remove them or clean up worktrees. Build it the way `workspace.create` was built: a new leaf plus a narrow exception in `SessionAuthorization` (`allowsManagedWorkspaceCreation` in `packages/server/src/server/authorization/index.ts`), leaving the daemon permission `workspace.manage` closed. The Host policy and path matching below carry over unchanged |
| Move creating into Developer, or add a level between Developer and Full access | Fixed role ladders (GitHub repository roles)                                   | No per-person choice, and a level per capability keeps growing                                                                                                                                                                                                                                                                                                                                                                    |
| Custom roles                                                                   | Cloud IAM, GitHub Enterprise                                                   | The end state for large organizations; too much to build for one capability                                                                                                                                                                                                                                                                                                                                                       |

### Decision

- Creating a Project stays with `workspace.manage`, which Full access holds. That privilege also renames and removes Projects, archives and pins workspaces, cleans up worktrees, and closes items in bulk (`packages/server/src/server/authorization/operation-permissions.ts`). Creating travels with managing.
- **Host policy**: `allow` (where Projects may be created) and `deny`. Defaults: allow `**`, deny `/`, `~`, `~/.ssh/**`, `/etc/**`. It binds every restricted session, Full access included; the Administrator level is not bound. Deny sits outside grants because grants combine by union: one grant's deny cannot stop another grant's allow. Cloud IAM calls this shape a permission boundary.
- **Set by environment**: `CLISBOT_PROJECT_FOLDERS_ALLOW` and `CLISBOT_PROJECT_FOLDERS_DENY`, comma- or newline-separated patterns, each replacing its default list when set; an empty value clears it (`project-folder-policy.ts`). The daemon reads them on every creation check, so a deployment writes the policy once and every grant needs only its level.
- **A grant may narrow**: optional `projectFolders: { allow, deny }` on a Full access Host grant applies inside the Host policy (**Narrow Project folders** on the grant sheet). Without it the grant creates wherever the Host policy allows. A narrowed grantor passes narrowing on: each allowed folder must lie under one of theirs, compared by path prefix, and their deny rules come along (`projectFoldersCovered` in `packages/hub/src/access/grantor.ts`). The Hub sends one rule set per creating Host grant in the ticket's `projectFolders`.
- **Matching** uses the realpath of the final path (`project.add` and `open_project`: `cwd`; `project.create_directory`: parent plus new name; `project.github.clone`: the folder named after the repository, as the clone handler names it), so `..` and symlinks in a request cannot escape. The daemon resolves `~`. `*` matches one segment, `**` any depth including none, deny wins. Windows paths compare with `/` and without case (`packages/protocol/src/project-folders.ts`).
- **Patterns** are `**` or absolute paths with no `.` or `..` segment; the Hub refuses others on a grant, and an invalid deny pattern in the environment denies everything. Host policy patterns are resolved through symlinks, so `/etc/**` still denies on macOS where `/etc` is `/private/etc`. Grant patterns are matched as written: a delegating Member could otherwise point one through a symlink they placed. Write grant folders as canonical paths.
- **A deny also covers what contains it**: a Project at `/Users` or `/workspace` would contain `~/.ssh` or `/workspace/prod-*`, so those folders are refused too.
- Creating a Project inside an existing Project is refused: the new Project takes the folder away from everyone granted only the outer Project. So a Full access grant on a Project manages that Project but creates none; only Host grants create. Reopening an existing Project root or workspace folder creates nothing and follows that Project's grant.
- A narrowed grantor passes their narrowing on without being asked: the grant sheet starts from their folders and deny rules, and the switch stays on.
- The check goes in the `new-project` branch of `workspaceManagementTarget` (`packages/server/src/server/managed-access/workspace-management.ts`), which already covers all three creation requests.
- Known limit: a Host grant reaches every Project on the Host. Someone who may create Projects also manages every other Project there. Giving the creator a grant on only what they create is later work: the daemon's Project snapshot to the Hub (`packages/hub/src/access/daemon-projects.ts`) does not carry the creator.

### Folder search

- Bug today: a restricted session cannot search folders in Add project, Full access on a Host included. The flow sends `directory_suggestions_request` without `cwd` (`packages/app/src/components/add-project-flow.tsx`), and the authorizer refuses a request without `cwd` and allows one with `cwd` only inside an existing Project (`allowsWorkspaceInbound` in `resource-authorizer.ts`). Folder search, the GitHub clone location, and the new-folder parent page all come back empty.
- Rule: you can search where you can create. A session that may create is allowed the request, and the daemon filters the results with the same check it uses to create: a folder you may create a Project in, or a folder on the way to one.
- Built on the same check as creation (`filterProjectFolderSearch` and `mayBrowseForProjectAt`), so the two cannot disagree. A Project-level Full access holder, who creates nothing, gets no folder search.

## Developer and Full access after this change

| Can                                                                                                                                                                       | Developer                 | Full access               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------- |
| Chat agents within the allowed Agent configurations                                                                                                                       | ✅                        | ✅                        |
| Approve every tool, run without prompts                                                                                                                                   | ✅                        | ✅                        |
| Create workspaces and worktrees                                                                                                                                           | ✅                        | ✅                        |
| Terminal profiles, chosen per grant                                                                                                                                       | ✅                        | ✅                        |
| Terminal (shell)                                                                                                                                                          | Off by default; can be on | On by default; can be off |
| `workspace.manage`: create Projects (Host grants only, within the Host policy); rename and remove Projects; archive and pin workspaces; clean up worktrees; close in bulk | —                         | ✅                        |
| Can share                                                                                                                                                                 | Off by default; can be on | On by default; can be off |

A Developer who needs to create Projects gets Full access. With Terminal and Can share off, that grant creates and manages Projects without a shell and without granting access to others.

- **Can share is a switch on Full access, on by default.** `workspace.manage` no longer implies it (`impliedPrivileges` in `packages/hub/src/access/contract.ts`); the Full access level names it, and choosing the level turns the switch on. Migration `0085` writes it into stored grants that held `workspace.manage` without it, so they keep sharing.

## Screens

Same form, same model: one grant is Who × Resource × Level plus modifiers ([The Access screen](access-screen.md)). This design adds two modifiers to Host and Project grants: **Terminal** and **Terminal profiles**.

Grant sheet, Full access on a Host:

```
Access level          [ Full access                                ▾]
                      Developer, plus creating and managing Projects.
Can share                                                     [ on  ]
Allowed Agent configurations   Codex (2 models) · Claude (all)      ▸
Use Fast mode                                                 [ off ]
Terminal profiles     All profiles, included with Terminal
Terminal (shell)                                              [ on  ]
                      Runs any command. Reads every file the daemon can, secrets included.
Narrow Project folders                                        [ off ]
                      Creates Projects wherever the Host folder policy allows, unless narrowed here.
  Allow  [ /workspace/** ]     Deny  [ /workspace/prod-*/** ]
```

Developer shows the same sheet without the Projects lines, with Terminal off and a profile picker (`[ Claude Code ×  Codex ×  + Add ]`).

- Profiles are the Host's own list. A profile the grantor does not hold is not offered; a field the grantor cannot grant shows why, not a disabled control with no reason.
- The grant confirmation lists what changes in words, including the shell.
- A grant row's Details column adds `Terminal` and `N profiles`.

For people without Administrator on the Host:

- Settings › Host › Terminals says **Only a Host Administrator can change these** instead of "No profiles yet", and hides the hooks switch rather than showing it off. Today both read as empty because the config request is refused.
- The launch menu and the workspace **+** menu list only granted profiles, from `terminal.profile.list.request`. **Terminal** (shell) appears only with `terminal.use`; **Manage profiles** only with `daemon.manage`.
- **Add project** searches only where the user can create. A refused path answers "access denied" as before.

## Principles this follows, and the gaps it accepts

| Principle                                                               | Here                                                                                                                                                     |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Least privilege                                                         | Developer loses the shell by default; profiles are granted one by one                                                                                    |
| Separation of privilege                                                 | Manage, share, and operate the daemon are separate levels or switches                                                                                    |
| Secure defaults at the scope, narrowing on the assignment               | Host policy sets the folders; a grant may narrow                                                                                                         |
| Deny by default, fail closed                                            | Unknown `profileId` is an error; a blocked path fails                                                                                                    |
| Complete mediation, decided on the server                               | The daemon resolves the command, checks every terminal operation and stream frame, filters folder search; the Clisbot terminal tools are open decision 3 |
| Do not disclose what you cannot use                                     | Hidden terminals are absent from lists; unknown and foreign ids answer the same; search shows only reachable folders                                     |
| Canonicalize before matching                                            | Realpath before folder rules; `~` resolved by the daemon; a leading `-` in a prompt escaped                                                              |
| An outer limit over additive grants                                     | Host policy block list                                                                                                                                   |
| Delegation without escalation                                           | Grant at most what you hold, including profiles and folder narrowing                                                                                     |
| Explain effective access; warn before risky grants                      | Level summary, via Host/Team markers, the shell warning                                                                                                  |
| Audit                                                                   | Each terminal records its creator                                                                                                                        |
| **Accepted gap:** creating travels with managing                        | Whoever may create may also remove Projects and clean up worktrees in the same scope. `project.create` is the later fix                                  |
| **Accepted gap:** the requester approves their own actions              | Inside a TUI and in chat the person asking also approves. Routing TUI prompts through agent hooks is later work                                          |
| **Accepted gap:** no expiry, no periodic access review, no OS isolation | Out of scope here; isolation is in [Later phases](README.md#later-phases)                                                                                |

## Watch before deciding more

- **Clisbot terminal tools for a creator without Terminal** stay on. Revisit if a level gains `approval.other` without `approval.command`, if agent-opened shells show up where their creator could not open one, or if an owner-only terminal rule lands. The candidate fix is [open decision 2](#open-decisions).

## Not built yet

- A path tester (the form's "Test a path" line) and a Settings › Host › **Project folders** page. The Host policy is read from the environment only.
- **Granted in N grants** on a Terminal profile row, and confirming an edit with that count.
- Naming the rule that refused a path in Add project.
- An access event for the grant migration.
- A grant for the creator on only what they create; `project.create` if create-only is needed; routing TUI tool prompts through agent hooks so a profile follows `approval.*`; an audit of the other Clisbot tools that act with daemon authority (`create_agent`, `update_agent`, `respond_to_permission`, `create_schedule`).

## Rollout

Update and restart every daemon before the Hub. A daemon that predates `terminal.profile.use` rejects any ticket that names it, and after migration `0085` every Developer ticket does; that strictness is the documented per-Project rule, kept on purpose. In the other direction, an older Hub refuses a new daemon's Project snapshot because it now carries `terminalProfileCatalog` (the snapshot schema is strict), so the Hub's Project list stays as it was until the Hub is updated. The Hub restart reconnects every daemon, which republishes (`relationship-controller.ts`), so nothing has to be redone.

## Open decisions

1. **Workspace scripts and worktree setup commands** run in a shell and need only `project.use` or `workspace.create`. Their terminals count as shells, so a user without Terminal cannot watch their output either. Options: leave as is; let such users watch but not type; or require `terminal.use` to start them.
2. **A grant switch that turns off the five Clisbot terminal tools.** Requested so an admin can remove them for risky users. Candidate: a leaf `agent.terminal_tools.use` (on for Developer and Full access, off for Office worker, folded into `0085`); at agent creation the daemon puts the five tools in `disabledTools` when the creating session lacks it. Unresolved:
   - **Whose grant.** The tool set is fixed when the agent starts, but anyone with `agent.interact` can prompt it. Reading the creator's grant lets a switched-off user drive a colleague's agent that has the tools. A Project-level setting avoids the question but is not a per-person grant.
   - **Holes to close with it.** Persist the choice on the agent record (`prepareSessionConfig` recomputes the policy from the provider on every create, resume, and reload); make a child agent from `create_agent` inherit it; decide which authority an agent created by a channel Route or an automation reads.
   - **How it combines with the Project limit** in open decision 3.
3. **A Project limit on the Clisbot terminal tools.** `list_terminals` (with `all`), `kill_terminal`, `capture_terminal`, and `send_terminal_keys` accept any terminal on the Host, so a Developer's agent can read and type into shells of Projects the Developer cannot open, each call behind an `approval.other` prompt that Developer holds. A limit was built and then removed on 2026-09-26, pending this decision:
   - **Every agent, by its own Project**, under Managed Access `external`: an answer for an id outside it is "not found". Small (one module, about 15 lines in `clisbot-tools.ts`), but it also limits an Administrator's agents, because an agent does not record who started it.
   - **Only agents a restricted session started**: needs the agent record to keep the starting session's authority, the same gap as open decision 2's "Whose grant".
   - **Leave unscoped**: no upstream diff; the cross-Project reach stays.

### Duyệt thư mục khi Add Project

`server_info.features.projectDirectoryBrowse` bật bộ duyệt thư mục Host trên web/mobile/desktop. Client gửi `directory_suggestions_request` với `browsePath` tùy chọn (không có `cwd`); daemon yêu cầu `workspace.manage`, chuẩn hóa realpath, kiểm tra quyền duyệt thư mục hiện tại rồi lọc từng thư mục con bằng cùng `filterProjectFolderSearch` trước khi giới hạn kết quả. `directory` tùy chọn trong response chứa đường dẫn hiện tại, cha được phép duyệt, `canSelect` và trạng thái giới hạn 100 kết quả. Chọn thư mục vẫn đi qua Add Project và kiểm tra quyền tạo hiện hành. Request tìm kiếm cũ không thay đổi; app chỉ dùng chế độ mới khi Host quảng bá capability, Host cũ hiện hướng dẫn cập nhật.
