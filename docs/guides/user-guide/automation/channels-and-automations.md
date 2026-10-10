# Channels and Automations

[User guide](../README.md) · [Grant Access](../access/members-and-teams.md) · [Q&A](../help/faq.md)

|                    | Channel                                            | Automation                                                   |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------------ |
| Purpose            | Receive/send conversations over Slack, Telegram…   | Run a job or a multi-step Workflow                           |
| Main configuration | Connection, conversation, route and where to reply | Steps, Host/Project, Agent configuration, inputs and results |
| How to use         | Send a message into the configured conversation    | Run directly, on an event, or on a message through a Channel |
| User permission    | Match an audience rule of the Route (Who + Where)  | `automation.run` to run directly                             |

A Channel can hand off to an Automation, or directly to **Start or continue an Agent** or **Start or continue a Bot**. So not every Channel message creates a Workflow run. Inside an Automation, choosing to continue the same Agent still creates a new Automation run for each request.

## Put a Bot on a Channel

Owner/Admin does this:

1. Open the Bot's **…** menu in the sidebar, or **Chat options** while in a private chat with the Bot, and choose **Connect to a channel…**.
2. The **Add Route** form opens with **Start or continue a Bot** and the Bot selected. Host, Project and AI configuration belong to the Bot; the form shows them read-only.
3. Pick an existing Connection or **Connect a new one**, set Rules (who can message, and where) and how to reply, then **Activate Route**.

The Route uses the Bot's AI configuration as of when you save. After you change the Bot's model, open the Route and save it again so it picks up the new configuration.

## Set up an Automation that takes work over chat

Owner/Admin does this:

1. Open **Channels**, create/configure the provider's Connection; enter credentials as the form asks and save. Check that the Connection works.
2. Open **Automations**, create a job/Workflow, and pick the Host, Project and Agent configuration.
3. Add/edit steps. In **Result**, configure the reply content/channel you need.
4. Choose **Add input → Channel conversation**, then pick the Connection and source conversation. Check the route, the receive conditions and where it replies.
5. Pick the audience; the default is private, **Only you**; widen it when ready. Save the Workflow and the input.
6. In **Access**, grant Channel access to Teams/Members for the right conversation; users link their Slack/Telegram identity in **Account** if needed.
7. Send a real message as a granted user and check the run and the reply in the conversation.

Connection and Workflow are saved separately. If the Workflow saved but the input failed, fix and save the input again in the same flow; check existing records before recreating to avoid duplicates. Do not rely on an unsaved draft after a reload.

## Control with slash commands

Type `/help` to see the shared commands. The [slash command guide](../../../features/slash-commands/user-guide.md)
explains how to use them; the [permission and scope table](../../../features/slash-commands/README.md)
is the full reference.

- Direct Route: `/new <text>`, `/resume <id>`, `/stop`, `/steer`, `/queue`
  control the Agent session; `/agent`, `/provider`, `/model`, `/effort`, `/permission`
  change configuration within the granted scope.
- `/fork [text]` continues in a new session with history; `/side <text>` and
  `/quick <text>` answer once on the side without changing the current binding.
- Automation Route: `/status`, `/cowork`, `/stop`, `/me`, `/help` work;
  direct session/configuration commands reply that they do not apply.
- `/cowork`, `/status`, `/me` and configuration results go to the caller by DM
  when the command comes from a public conversation. If the DM cannot be sent,
  that information is not posted back to the conversation.

In **Access**, you can grant **Guest** access so people not linked to a Hub
Member can use the Channel. Guest has no access by default; a linked Member uses
Member/Team access and does not pick up Guest access. A provider change is saved
and waits for `/new` or `/fork` to apply; ordinary messages still go to the current session.

## App only or Channel only

- To open a Project/terminal in the app: grant **Connect + Project access**.
- To run an Automation directly: grant **Run** on that Automation.
- To call a fixed flow over a Channel: grant **Channel access**, link the identity and add the person to the right audience. Calling a configured route does not need Connect/Project/Automation Run.

Permission to run a fixed job does not let the caller pick any Project or model, or open a terminal. Execution config and service permissions are checked separately at setup. For jobs the Hub executes, check that the daemon is enrolled and the Hub relationship has the `hub.execute` permission it needs.

**Send test message** only proves outbound sending works. To check the whole flow, send a real inbound message and check the activity/run and the reply. If no reply arrives, see [Q&A](../help/faq.md).
