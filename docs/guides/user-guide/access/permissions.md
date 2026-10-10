# Permissions: what each grant gives

[User guide](../README.md) · [Grant Access](members-and-teams.md) · [Daemon Administrator](daemon-administrator.md) · [Q&A](../help/faq.md)

This page answers: **what can someone do with a given level on a given resource, and what follows from it.** How to grant is in [Grant Access](members-and-teams.md).

Everything below applies only when the daemon has [Managed Access **external**](../hosts/managed-access.md) on. In `off` mode, anyone who can pair with the daemon has full rights.

## 1. Three things to know first

1. **Permissions are always granted on a resource**: Host, Project, Connection, or Automation. Workspaces and worktrees are not granted separately; they follow the permissions of the Project that contains them.
2. **Permissions only add up, never subtract.** A user gets the sum of their direct grants and the grants from all their Teams, on Hosts and on Projects. A smaller grant does not reduce a larger one.
3. **This is not a sandbox.** Anyone with Terminal (shell), approval for shell commands, or a Terminal profile where they approve tools themselves can run anything the daemon's account can run, including past Project or model limits. For real isolation, use a separate OS user or container.

## 2. Resources and scope

| Resource                            | Granting here applies to                                       | Levels you can choose                                         |
| ----------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| **Organization**                    | The whole organization; set by role, not by assignment         | Owner, Admin, Member                                          |
| **Host** (one daemon)               | **Every Project** on that Host, including Projects added later | Connect, Office worker, Developer, Full access, Administrator |
| **Project**                         | Only that Project, and every workspace/worktree inside it      | Office worker, Developer, Full access                         |
| **Workspace, worktree**             | Not granted separately; follows the Project that contains it   | —                                                             |
| **Connection** (Slack, Telegram...) | Every conversation of that Connection                          | Admin                                                         |
| **Automation**                      | One Hub Automation                                             | Run                                                           |

Organization roles:

| Role   | Meaning                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| Owner  | Full rights over the organization and every resource, now and later                                          |
| Admin  | Manages configuration, Members, Teams, and Access. Does **not** get to use daemons or Projects automatically |
| Member | Uses only what is granted directly or through a Team                                                         |

## 3. What each level can do

Office worker, Developer, and Full access granted on a Host apply to every Project on that Host; granted on a Project, they apply only to that Project. Connect and Administrator exist only on a Host.

| Object                   | Action                                                                              | Office worker |            Developer             |           Full access            |  Administrator   |
| ------------------------ | ----------------------------------------------------------------------------------- | :-----------: | :------------------------------: | :------------------------------: | :--------------: |
| **Host**                 | Connect to the Host (Connect)                                                       |      ✅       |                ✅                |                ✅                |        ✅        |
|                          | Restart, update, edit daemon configuration, enable providers, install plugins       |       —       |                —                 |                —                 |        ✅        |
|                          | Manage daemon access, the Hub connection, turn Managed Access on/off                |       —       |                —                 |                —                 |        ✅        |
|                          | Schedules and loops running on the daemon                                           |       —       |                —                 |                —                 |        ✅        |
| **Project**              | See and use granted Projects                                                        |      ✅       |                ✅                |                ✅                | ✅ every Project |
|                          | **Create new Projects**                                                             |       —       |                —                 |               ✅ ¹               |  ✅ any folder   |
|                          | Rename, change icon, **delete** a Project                                           |       —       |                —                 |                ✅                |        ✅        |
| **Workspace / worktree** | Create local workspaces, create worktrees                                           |       —       |                ✅                |                ✅                |        ✅        |
|                          | Archive, restore, rename, pin workspaces; clean up worktrees (can delete from disk) |       —       |                —                 |                ✅                |        ✅        |
|                          | Close many agents/terminals at once                                                 |       —       |                —                 |                ✅                |        ✅        |
| **Agent**                | Chat, stop, change model in an existing session                                     |      ✅       |                ✅                |                ✅                |        ✅        |
|                          | Create new sessions                                                                 |      ✅       |                ✅                |                ✅                |        ✅        |
|                          | Limited to the chosen providers/models                                              |      Yes      |               Yes                |               Yes                |      **No**      |
|                          | Fast mode                                                                           |    Opt-in     |              Opt-in              |              Opt-in              |        ✅        |
| **Terminal**             | Open the chosen Terminal profiles (agent CLI, no shell)                             |       —       |                ✅                |                ✅                |        ✅        |
|                          | Open a shell and type any command (**Terminal (shell)**)                            |       —       | Off by default, can be turned on | On by default, can be turned off |        ✅        |
| **Approvals**            | Edit files                                                                          |      ✅       |                ✅                |                ✅                |        ✅        |
|                          | Config edits, ordinary shell commands                                               |       —       |                ✅                |                ✅                |        ✅        |
|                          | Destructive commands (`rm -rf`, `git reset --hard`...), other tools (WebFetch, MCP) |       —       |                ✅                |                ✅                |        ✅        |
|                          | Run agents without approval prompts                                                 |       —       |                ✅                |                ✅                |        ✅        |

¹ Only Full access **on a Host**, and only in folders the **Host's folder policy** allows (section 4). Full access **on a Project** manages that Project but creates no Projects. No Project can be created inside another Project.

Each level in short:

- **Office worker**: uses agents in existing workspaces. No terminal, no command approvals.
- **Developer**: full work inside the Project (Terminal profiles, worktrees, approving every command), **no shell** unless **Terminal (shell)** is on, and **does not create or manage** Projects or workspaces.
- **Full access**: Developer plus a shell, plus creating and managing Projects, workspaces, and worktrees. You can turn off the shell and Can share per grant, for example so someone can create Projects without a shell.
- **Administrator**: operates the whole daemon and is **not limited by provider/model**. See [Daemon Administrator](daemon-administrator.md).

Connection and Automation:

| Level                  | What it allows                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection → **Admin** | Edit the audience rules, Routes, and Route default of that Connection, in the app and in chat. Who may talk to the bot is set in the Route's audience rules, not granted here |
| Automation → **Run**   | Run that Automation                                                                                                                                                           |

## 4. Consequences to know before granting

| When you grant                                     | Consequence                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any level **on a Host**                            | Also applies to Projects added **later**. You do not grant again                                                                                                                                                                                                                                                                    |
| **Full access on a Host**                          | Creates Projects in folders the Host's policy allows. By default that is everywhere except `/`, `~`, `~/.ssh/**`, `/etc/**`; change it with the `CLISBOT_PROJECT_FOLDERS_ALLOW` and `CLISBOT_PROJECT_FOLDERS_DENY` environment variables on the daemon machine. You can narrow it further per grant with **Narrow Project folders** |
| **Full access** (on any scope)                     | Deleting a Project **stops agents and closes terminals for everyone** in that Project. Cleaning up a worktree can **delete the folder on disk**, losing uncommitted work                                                                                                                                                            |
| Creating a Project **inside** another Project      | **Blocked.** The inner Project would take that folder away from everyone who has rights only on the outer Project                                                                                                                                                                                                                   |
| A Project creator with Full access **on the Host** | The new Project is covered by the Host grant and usable after **reconnecting** to the Host                                                                                                                                                                                                                                          |
| Choosing **Guest**                                 | Guest is **everyone** who sends messages on a Channel without a linked account, not one person                                                                                                                                                                                                                                      |
| **Administrator**                                  | Removes provider/model limits, and can manage the daemon's own permission system                                                                                                                                                                                                                                                    |
| Provider/model limits                              | Block only agent sessions run through Clisbot. Someone with Terminal (shell) can still run a CLI with another model themselves                                                                                                                                                                                                      |
| Terminal profile                                   | Opens the agent CLI directly; exiting closes the terminal. The user still approves tools in that CLI, and the CLI can have its own shell escape (for example `!` in Claude Code)                                                                                                                                                    |

## 5. Quick pick

| Need                                                                                      | Grant                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Work with agents only in prepared workspaces                                              | **Office worker** on the Project                                                                                                             |
| Code with agents and Terminal profiles, create your own worktrees in a few fixed Projects | **Developer** on each Project                                                                                                                |
| Same, with a shell                                                                        | **Developer** with **Terminal (shell)** on                                                                                                   |
| Work on every Project of a Host, only with chosen models                                  | **Developer** on the Host                                                                                                                    |
| Same, and add new Projects                                                                | **Full access** on the Host; turn off **Terminal (shell)** and **Can share** if not needed                                                   |
| Operate the daemon machine, with every provider/model                                     | **Administrator** on the Host, only for people you trust                                                                                     |
| Only chat through Slack/Telegram or run one Automation                                    | Add them to the Route's audience rules; **Run** on the Automation; see [Channels and Automations](../automation/channels-and-automations.md) |

## 6. After upgrading

Update and restart **every daemon** first, then update the Hub. An old daemon **rejects the whole ticket** when it carries a permission the daemon does not know, so in the reverse order that person cannot reach the Host.

In the 2026-09-26 release the Hub migrated stored grants on its own; you do not need to save them again:

| Existing grant            | After the update                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| Developer (with terminal) | Opens every Terminal profile, **loses the shell**. Turn **Terminal (shell)** back on if needed |
| Full access               | Keeps the shell and Can share; gains every Terminal profile                                    |
| Full access on a Project  | Can no longer create Projects, even inside that Project                                        |

For earlier releases, open **Access**, **Edit** the assignment, choose the level again, and save:

| Change                                                                 | Effect if not saved again                   |
| ---------------------------------------------------------------------- | ------------------------------------------- |
| Developer and Full access gained creating workspaces and worktrees     | Cannot create workspaces or worktrees       |
| Approving other tools was added (`approval.other`)                     | Cannot run agents in no-approval mode       |
| Full access gained creating and managing Projects (`workspace.manage`) | Full access still works only like Developer |
