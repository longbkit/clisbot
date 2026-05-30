# Jira Server Webhook Ingress-Only Automation

Status: recommended lightweight post-MVP validation path.

## Purpose

Validate that the generic API bot can receive Jira Server/Data Center webhook
events and trigger the right agentic workflow without adding Jira REST writeback
actions to clisbot.

This is the smaller alternative to a full Jira plugin:

- clisbot API bot handles ingress, auth, filtering, mapping, queue/steer, and
  result polling
- the agent uses existing Jira MCP/CLI tooling to read/update Jira
- no `issue.comment.add`, `issue.description.update`, `issue.assignee.set`, or
  `issue.transition` actions are required in the API-channel contract
- no Jira PAT needs to be stored in clisbot API bot action config

Goal: after API bot MVP, prove that Jira Server automation works as a webhook
event source for AI-native workflows.

## Relationship To Full Jira Plugin Thinking

[Jira Server API Bot AI Native Workflow](2026-05-30-jira-server-api-ai-native-workflow.md)
is the full-flex direction where Jira mutations become named clisbot actions.
That is useful if clisbot itself should own Jira delivery, delivery status,
retry/idempotency, and resource mutation contracts.

This doc intentionally avoids that work. It treats Jira as:

- event source into clisbot
- work surface for the agent through existing tools
- status/result source through clisbot result polling

This validates the API bot architecture with much less implementation.

## Existing Jira Tooling Assumption

Agents already have a Jira skill/CLI path:

```bash
jira jira-search --jql 'project = ENG ORDER BY updated DESC' --fields 'summary,status,assignee' --limit 20
jira jira-get-issue --issue-key ENG-123 --fields 'summary,status,description,assignee'
jira jira-update-issue --issue-key ENG-123 --fields-file ./ticket-payload.json
```

The Jira skill expects Jira config through environment variables such as:

- `ATLASSIAN_JIRA_URL`
- `ATLASSIAN_JIRA_PERSONAL_TOKEN`

Therefore clisbot does not need to template Jira REST calls inside
`bots.api.jira.actions` for this validation slice.

## Minimal Use Case

When a Jira issue enters `Human Reviewed`, clisbot should:

1. receive the Jira webhook event
2. authenticate it through the API bot ingress auth mode
3. filter to the target project/status/event type
4. map the issue into a stable API bot surface
5. enqueue or steer the agent run for that issue
6. expose event processing status through result polling
7. include enough prompt context for the agent to use Jira CLI/MCP safely
8. let the agent inspect/update Jira through the existing Jira tool

No provider delivery back to Jira is required.

## Ingress Auth

Preferred production path:

```text
Jira webhook -> internal webhook gateway -> clisbot API bot
```

The gateway should validate network/source/shared secret and forward with:

```http
POST /api/bots/jira/events
Authorization: Bearer <CLISBOT_JIRA_WEBHOOK_TOKEN>
```

Reason: Jira Server webhook auth/header customization varies by installation.
The API bot should support bearer ingress already; the gateway keeps Jira-specific
network/security work outside the generic API channel.

Local test path:

- `auth.mode: "none"` only on loopback
- post sample Jira webhook payloads with `curl`
- verify result polling and queued/steered behavior

## Config Sketch

```json
{
  "bots": {
    "api": {
      "jira": {
        "enabled": true,
        "ingress": {
          "successStatusCode": 202,
          "auth": {
            "mode": "bearer",
            "tokenEnv": "CLISBOT_JIRA_WEBHOOK_TOKEN"
          },
          "filter": {
            "all": [
              { "path": "$.webhookEvent", "equals": "jira:issue_updated" },
              { "path": "$.issue.fields.project.key", "in": ["PROD", "DEV"] },
              { "path": "$.issue.fields.status.name", "equals": "Human Reviewed" },
              { "path": "$.user.name", "notEquals": "{{env.JIRA_AI_USERNAME}}" }
            ]
          },
          "map": {
            "eventId": "{{$.webhookEvent}}:{{$.issue.id}}:{{$.timestamp}}",
            "surfaceKind": "issue",
            "surfaceId": "{{$.issue.key}}",
            "senderId": "$.user.name",
            "senderDisplayName": "$.user.displayName",
            "text": "Jira issue {{$.issue.key}} moved to {{$.issue.fields.status.name}}: {{$.issue.fields.summary}}",
            "runMode": "$.clisbot.runMode",
            "replyTargetId": "$.issue.key",
            "replyParams": {
              "issueId": "$.issue.id",
              "projectKey": "$.issue.fields.project.key"
            },
            "context": {
              "issueKey": "$.issue.key",
              "issueId": "$.issue.id",
              "summary": "$.issue.fields.summary",
              "status": "$.issue.fields.status.name",
              "assignee": "$.issue.fields.assignee.name",
              "priority": "$.issue.fields.priority.name"
            }
          }
        }
      }
    }
  }
}
```

No `actions` block is required.

Important prompt rule:

- `reply.params` remains provider-addressing metadata and must not be prompt
  context by default.
- The mapped `context` fields are safe prompt context and should include only
  what the agent needs to call Jira tools.

## Agent Prompt Shape

The agent should receive a clear operational instruction, for example:

```text
Jira issue PROD-123 reached Human Reviewed.

Use the Jira CLI/MCP tool to fetch the latest issue before acting:
jira jira-get-issue --issue-key PROD-123 --fields 'summary,status,description,assignee,priority,labels'

Do not rely only on webhook payload state. Update Jira through the Jira tool if
needed. Keep comments concise. If the issue is already handled or not eligible,
record a final result explaining why.
```

This keeps API bot responsible for event routing, while Jira-specific read/write
work stays inside the agent's existing tool workflow.

## Queue And Steer Semantics

Same issue surface:

- no active run: enqueue a new run
- active run and human comment/update event: steer the active run
- active run and AI-authored event: ignore or mark filtered
- duplicate event id: return duplicate result

Different issue surface:

- queue normally under normal clisbot queue policy

This is enough to validate AI-native Jira automation without issue-property
locks. If duplicate webhook bursts become a real problem, add issue-level lock
later in the full Jira plugin direction.

## What The Agent Can Automate Through Jira CLI/MCP

Discovery:

- fetch issue details and comments
- detect missing acceptance criteria or unclear customer impact
- add a concise clarification comment

Design:

- rewrite or propose description improvements
- add design checklist or edge-case comment
- link related tickets if the Jira tool supports it

Implementation:

- inspect repo and issue together
- update Jira with implementation plan or PR link
- move work forward through existing team workflow if the tool supports update

Testing:

- add test plan comment
- summarize regression scope
- update status/comment after test evidence is available

Bug fixing:

- classify bug
- add reproduction and root-cause notes
- update issue after fix/verification

This doc does not require clisbot to know those Jira REST endpoints. It only
needs the agent's Jira tool to be available in the run environment.

## Minimal Validation Plan

After API bot MVP:

1. Configure `bots.api.jira` with bearer ingress and no actions.
2. Post a fixture `jira:issue_updated` payload for issue `PROD-123`.
3. Assert `POST /api/bots/jira/events` returns `202`.
4. Assert result polling shows `queued` then `processing` or terminal status.
5. Assert the agent prompt contains issue key, summary, status, and instruction
   to use Jira CLI/MCP.
6. Assert `reply.params` does not appear in prompt context.
7. Assert a second same-event post is `duplicate`.
8. Assert an AI-authored Jira event is filtered.
9. Run one live test where the agent uses `jira jira-get-issue` and posts or
   drafts an update through the existing Jira tool.

## Scope Boundary

In scope:

- Jira webhook as API bot event source
- bearer or local-only ingress auth
- filters/mapping for issue events
- event result polling
- queue/steer integration by `surfaceId`
- prompt context that tells the agent how to use Jira tools

Out of scope:

- Jira REST action templates in `bots.api.jira.actions`
- first-class Jira delivery status
- clisbot-owned Jira PAT action config
- issue property lock
- assignee automation
- transition automation
- description/comment edit as provider actions
- Jira Cloud `accountId` compatibility

## Recommendation

Use this ingress-only Jira doc as the post-MVP validation target.

It proves the most important architectural question: can the API bot receive
non-chat business-system events and route them into useful AI work? It avoids
turning the generic API channel into a Jira plugin too early.

Only graduate to the full Jira plugin direction if we need clisbot itself to own
Jira mutation contracts, delivery status, retries/idempotency, or a UI/API for
Jira resource actions.
