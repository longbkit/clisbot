# Clisbot + Hub user guide

Vietnamese version: [vi/README.md](vi/README.md).

Start with the [quick start](getting-started/quick-start.md), then pick a guide by task.

| What do you want to do?                                         | Guide                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Install on your machine or another one, connect web/phone       | [Quick start](getting-started/quick-start.md)                             |
| Upgrade Clisbot 0.1.x to v2                                     | [Upgrade to v2](getting-started/upgrade-v2.md)                            |
| Create a Slack/Codex bot, seed a workspace, run it again        | [Onboarding](getting-started/onboarding.md)                               |
| Set up the Hub, sign in with Google, register                   | [Setup and sign-in](account/setup-and-sign-in.md)                         |
| Change your display name and profile image                      | [Profile](account/profile.md)                                             |
| View and rename the organization                                | [Organization name](account/organization.md)                              |
| Change or reset a password, configure the master password       | [Password and recovery](account/password-and-recovery.md)                 |
| Enroll, unenroll, rename and manage several Hosts               | [Manage Hosts](hosts/connect-and-manage.md)                               |
| Pick a connection mode and enforce Hub permissions              | [Managed Access: off and external](hosts/managed-access.md)               |
| Invite people, create Teams, grant and revoke access            | [Members, Teams and Access](access/members-and-teams.md)                  |
| Grant every Project on a Host, several Projects, several models | [Quick grants](access/members-and-teams.md#grant-every-project-on-a-host) |
| What each grant allows: permissions by Host, Project...         | [Access levels](access/permissions.md)                                    |
| Understand daemon administrator rights in full                  | [Daemon Administrator](access/daemon-administrator.md)                    |
| Create Projects, Workspaces, worktrees and sessions             | [Working in a Project](work/projects-and-workspaces.md)                   |
| Connect Slack/Telegram, run Automations                         | [Channels and Automations](automation/channels-and-automations.md)        |
| Find the cause of a problem and fix it                          | [Q&A and troubleshooting](help/faq.md)                                    |

## Four concepts to know

- **Hub**: manages the organization, members, permissions and shared configuration.
- **Host**: the daemon running on the machine that holds the source code and the AI tools.
- **Project**: a root folder registered on a Host.
- **Workspace**: where you work inside a Project; it uses the local folder or its own Git worktree. A Workspace can hold several Agent sessions.

This guide follows the current source code. Older apps and daemons may lack Rename Host, the new permission notices, or per-Project Workspace creation rights; read the [Q&A](help/faq.md) before updating grants already in use.

Deployment and architecture docs live outside the user guide: [development/deployment](../../development.md), [permissions contract](../../permissions.md), [developer guide](../developer-guide/upstream-sync-and-contribution.md).
