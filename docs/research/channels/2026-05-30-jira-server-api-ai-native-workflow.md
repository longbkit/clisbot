# Jira Server API Bot AI Native Workflow

Status: long-range thinking for scope review. This is a full-flex Jira plugin
direction for clisbot, not the API-channel MVP and not the lightest Jira
automation validation path.

For the lighter post-MVP validation path, see
[Jira Server Webhook Ingress-Only Automation](2026-05-30-jira-server-webhook-ingress-only-automation.md).

## Purpose

Explore using an API bot for Jira Server/Data Center so Jira issue events can
start agentic AI work, and clisbot can write progress, comments, description
updates, assignee changes, and workflow transitions back to Jira through a Jira
AI account using a personal access token.

This is intentionally broad: it assumes Jira mutations become first-class
clisbot actions. That can be valuable later, but it is heavier than needed to
validate API bot webhook automation. A smaller architecture is to let the API bot
receive Jira events and launch the agent, while the agent uses the existing Jira
MCP/CLI skill to inspect and update Jira.

The target product direction is AI-native product development: humans and AI
collaborate in Jira across discovery, design, implementation, testing, bug
fixing, and release hygiene without forcing every step through chat.

## Verified Jira API Baseline

Primary references:

- [Jira webhooks](https://developer.atlassian.com/server/jira/platform/webhooks/)
- [Jira REST API examples](https://developer.atlassian.com/server/jira/platform/jira-rest-api-examples/)
- [Jira REST issue API](https://developer.atlassian.com/server/jira/platform/rest/v10000/api-group-issue/)
- [Personal access tokens](https://confluence.atlassian.com/display/ENTERPRISE/Using%2Bpersonal%2Baccess%2Btokens)

Baseline assumptions for Jira Server/Data Center:

- Outbound Jira API calls can use a Jira AI account PAT with
  `Authorization: Bearer <token>`.
- Jira webhooks can emit issue and comment events such as issue updated,
  comment created, and comment updated.
- REST operations needed by this workflow exist as normal issue resources:
  update issue fields, assign issue, transition issue, add comment, and update
  comment.
- Jira Server/Data Center user addressing commonly uses `name` or user key. Jira
  Cloud `accountId` is out of scope for this doc unless a later Cloud bot is
  created.

## Decision Snapshot

- Public channel remains `api`; bot config is `bots.api.jira`.
- Jira webhook ingress uses `POST /api/bots/jira/events`.
- Jira outbound mutations should be named actions, not a top-level `outbound`
  block.
- `actions.message.send` may map to add-comment for simple visible messages,
  but description edits, comment edits, assignee changes, transitions, and issue
  properties need explicit resource action names.
- PAT is used only for outbound Jira REST actions. Inbound webhook auth is a
  separate clisbot endpoint concern.
- AI must not infer assignee routing from free text unless configured. Use
  explicit fields, role mappings, or workflow state.
- The workflow needs an issue-level lock/state record to avoid duplicate AI runs
  and self-trigger loops.

## First Useful Scenario

Human reviews an issue and moves it to `Human Reviewed`.

Expected automation:

1. Jira emits an issue updated webhook.
2. clisbot API bot filters for target project/status and accepts the event.
3. clisbot deduplicates the event and checks issue-level AI lock/state.
4. clisbot snapshots ownership:
   - previous assignee
   - reporter
   - dev owner
   - tech lead
   - QC owner
   - PO/product owner
   - priority, sprint, labels, components, fix version
5. clisbot assigns the issue to the Jira AI account.
6. clisbot transitions the issue to an AI-owned status such as
   `AI In Progress` if the Jira workflow has one.
7. clisbot creates or updates one AI progress comment.
8. The agent processes the issue:
   - clarifies requirement gaps
   - updates description in an AI-owned section
   - adds implementation notes or checklist comments
   - opens code tasks/branches/PRs if connected to the repo workflow
   - reacts to human steering comments while active
9. On completion, clisbot writes final result and transition recommendation.
10. clisbot assigns the issue back to the correct human role and transitions it
    to the next configured status, for example:
    - `Ready for Dev Review`
    - `Ready for Lead Review`
    - `Ready for QA`
    - `Needs PO Clarification`
    - `Blocked`

## Inbound Webhook Config Sketch

Jira Server webhooks may not reliably support custom outbound auth headers in
all installations. Prefer a trusted internal gateway when Jira cannot send
`Authorization: Bearer ...` directly.

Recommended production path:

```text
Jira webhook -> internal webhook gateway -> clisbot API endpoint
```

The gateway validates source/network/shared secret and forwards:

```http
POST /api/bots/jira/events
Authorization: Bearer <CLISBOT_JIRA_WEBHOOK_TOKEN>
```

Local testing can use `auth.mode: "none"` only on loopback.

Example bot config:

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
              { "path": "$.webhookEvent", "in": ["jira:issue_updated", "comment_created", "comment_updated"] },
              { "path": "$.issue.fields.project.key", "in": ["PROD", "DEV"] },
              { "path": "$.issue.fields.status.name", "in": ["Human Reviewed", "AI In Progress"] },
              { "path": "$.user.name", "notEquals": "{{env.JIRA_AI_USERNAME}}" }
            ]
          },
          "map": {
            "eventId": "{{$.webhookEvent}}:{{$.issue.id}}:{{$.timestamp}}",
            "surfaceKind": "issue",
            "surfaceId": "{{$.issue.key}}",
            "senderId": "$.user.name",
            "senderDisplayName": "$.user.displayName",
            "text": "{{$.webhookEvent}} {{$.issue.key}} {{$.issue.fields.summary}}",
            "runMode": "$.clisbot.runMode",
            "replyTargetId": "$.issue.key",
            "replyParams": {
              "issueId": "$.issue.id",
              "projectKey": "$.issue.fields.project.key"
            }
          }
        }
      }
    }
  }
}
```

Important filter note:

- Prefer Jira webhook JQL to pre-filter project and status when possible.
- If Jira webhook payload includes changelog, later add a small derived
  `changedFields` mapper so clisbot can detect "status changed to Human
  Reviewed" precisely.
- Without changelog support, clisbot can still filter current status and rely on
  event dedupe plus issue-level AI lock to avoid repeated starts.

## Required Jira Actions

This workflow needs more than `actions.message.send`.

Recommended action names:

| Action | Jira REST shape | First use |
| --- | --- | --- |
| `issue.fetch` | `GET /rest/api/2/issue/{issueKey}` | Refresh latest issue before mutation. |
| `issue.comment.add` | `POST /rest/api/2/issue/{issueKey}/comment` | Add final comments or status notes. |
| `issue.comment.update` | `PUT /rest/api/2/issue/{issueKey}/comment/{commentId}` | Edit one AI progress comment instead of spamming. |
| `issue.description.update` | `PUT /rest/api/2/issue/{issueKey}` with `fields.description` | Update AI-owned section in description. |
| `issue.assignee.set` | `PUT /rest/api/2/issue/{issueKey}/assignee` | Assign to AI and later back to human. |
| `issue.transition` | `POST /rest/api/2/issue/{issueKey}/transitions` | Move issue across workflow states. |
| `issue.property.get` | `GET /rest/api/2/issue/{issueKey}/properties/{key}` | Read AI lock/run state. |
| `issue.property.set` | `PUT /rest/api/2/issue/{issueKey}/properties/{key}` | Store AI lock/run state and progress comment id. |

`actions.message.send` can be an alias for `issue.comment.add` only for generic
visible output. It must not be reused for assign, transition, edit comment, or
edit description.

Example outbound action config:

```json
{
  "actions": {
    "issue.comment.add": {
      "method": "POST",
      "url": "{{env.JIRA_BASE_URL}}/rest/api/2/issue/{{reply.targetId}}/comment",
      "headers": {
        "Authorization": "Bearer {{env.JIRA_PAT_TOKEN}}",
        "Content-Type": "application/json"
      },
      "body": {
        "body": "{{comment.body}}"
      },
      "retry": {
        "mode": "none"
      }
    },
    "issue.description.update": {
      "method": "PUT",
      "url": "{{env.JIRA_BASE_URL}}/rest/api/2/issue/{{reply.targetId}}",
      "headers": {
        "Authorization": "Bearer {{env.JIRA_PAT_TOKEN}}",
        "Content-Type": "application/json"
      },
      "body": {
        "fields": {
          "description": "{{issue.description}}"
        }
      },
      "retry": {
        "mode": "none"
      }
    },
    "issue.assignee.set": {
      "method": "PUT",
      "url": "{{env.JIRA_BASE_URL}}/rest/api/2/issue/{{reply.targetId}}/assignee",
      "headers": {
        "Authorization": "Bearer {{env.JIRA_PAT_TOKEN}}",
        "Content-Type": "application/json"
      },
      "body": {
        "name": "{{user.name}}"
      },
      "retry": {
        "mode": "none"
      }
    },
    "issue.transition": {
      "method": "POST",
      "url": "{{env.JIRA_BASE_URL}}/rest/api/2/issue/{{reply.targetId}}/transitions",
      "headers": {
        "Authorization": "Bearer {{env.JIRA_PAT_TOKEN}}",
        "Content-Type": "application/json"
      },
      "body": {
        "transition": {
          "id": "{{transition.id}}"
        }
      },
      "retry": {
        "mode": "none"
      }
    }
  }
}
```

## State And Locking Model

Use both clisbot result state and Jira issue property state.

clisbot result state:

- event-level truth
- status/progress/result/error
- active run reference
- delivery attempts

Jira issue property, for example `clisbot.aiRun`:

```json
{
  "runId": "api:jira:PROD-123:2026-05-30T06:00:00Z",
  "status": "processing",
  "startedAt": "2026-05-30T06:00:00Z",
  "startedByEventId": "jira:issue_updated:10001:1780120000",
  "aiUser": "jira-ai",
  "previousAssignee": "dev.a",
  "progressCommentId": "123456",
  "nextOwnerPolicy": "role_field",
  "nextOwner": {
    "role": "dev",
    "name": "dev.a"
  }
}
```

Why store a Jira issue property:

- Jira remains self-describing even if clisbot restarts.
- A second clisbot worker can see that AI already owns the issue.
- Human auditors can inspect state through Jira admin/API.
- Progress comment id and original assignee survive process restarts.

## Active Issue Event Rules

When a new Jira event arrives for an issue with active AI state:

- comment from human: steer the active run
- description change by human: steer the active run
- status moved out of AI state by human: stop or handoff the active run
- event authored by AI user: ignore unless it is needed to confirm action
  delivery
- duplicate webhook event id: return duplicate result
- same issue transitioned to `Human Reviewed` again while active: do not start a
  second run; record duplicate or steer based on changelog
- different issue: queue normally

This keeps Jira collaboration close to current clisbot queue/steer semantics:

- `queue`: new issue work item enters the agent queue.
- `steer`: human updates the active issue and the active run receives new
  instructions.
- `pause/stop`: human workflow transition or explicit comment command can stop
  the AI run.

Optional Jira comment commands:

- `@ai queue`: enqueue this issue for AI processing
- `@ai steer <text>`: inject steering into active run
- `@ai pause`: stop after current safe point
- `@ai handoff dev|lead|qc|po`: stop and assign to configured role
- `@ai resume`: continue an existing AI run if lock state allows it

Only trusted Jira roles should be allowed to issue these commands.

## Description And Comment Safety

Description updates are high-risk because they can overwrite human content.

Rules:

- Always fetch the latest issue immediately before description update.
- Modify only an AI-owned section, for example:

```text
h2. AI Working Notes
<!-- clisbot:start -->
...
<!-- clisbot:end -->
```

- If markers do not exist, append a new AI section instead of rewriting the
  whole description.
- Do not remove human-authored description content.
- If the latest description changed since the agent read it, refetch and merge
  before writing.
- For progress, prefer editing one AI progress comment over adding many
  comments.
- Add a final immutable summary comment when the run reaches a terminal state.

## Role Routing

Do not guess the "right person" from free text.

Use a configured routing policy:

```json
{
  "routing": {
    "aiUser": "{{env.JIRA_AI_USERNAME}}",
    "owners": {
      "dev": "$.issue.fields.customfield_dev_owner.name",
      "lead": "$.issue.fields.customfield_tech_lead.name",
      "qc": "$.issue.fields.customfield_qc_owner.name",
      "po": "$.issue.fields.customfield_po_owner.name",
      "fallback": "$.issue.fields.assignee.name"
    },
    "nextOwnerByOutcome": {
      "implementation_ready": "dev",
      "needs_technical_review": "lead",
      "ready_for_test": "qc",
      "needs_product_clarification": "po",
      "blocked": "lead"
    }
  }
}
```

If a role field is missing, assign to fallback and add a comment explaining the
missing routing field.

## Product Development Automation Flow

Discovery:

- detect weak issue descriptions, missing customer impact, unclear success
  metric, duplicate issues, missing priority, and missing owner
- draft clarification questions
- link related issues, epics, incidents, customer tickets, and Confluence pages
- propose acceptance criteria and non-goals

Design:

- turn raw discovery into a structured Jira description
- add UX/design checklist
- call out unknown data contracts, permission rules, edge cases, and analytics
- request PO/Design review when ambiguity remains

Implementation:

- create implementation plan from issue + repo context
- create branch/PR if code integration is enabled
- keep a single Jira progress comment updated with current step, risk, and next
  action
- update description with AI-owned implementation notes
- move to lead/dev review when code and tests are ready

Testing:

- generate test plan and regression checklist
- map acceptance criteria to test cases
- when QC comments or bug events arrive, steer the active run instead of
  starting a new one
- assign back to QC when fixes are ready

Bug fixing:

- classify bug source: requirement gap, implementation bug, data issue,
  environment issue, flaky test, or duplicate
- gather logs/repro steps
- propose fix plan and risk
- update Jira with fix summary and verification evidence

Release:

- draft release notes from resolved issues
- flag migration/rollback risks
- update documentation checklist
- assign to PO/lead for final release approval

## Minimal Implementation Slices

Slice 1: Jira event intake and comments

- receive Jira issue/comment webhooks
- filter target projects/statuses
- map issue surface
- result polling works
- `actions.message.send` or `issue.comment.add` writes comments with PAT

Slice 2: AI ownership loop

- issue property lock
- assign to AI account
- progress comment add/update
- status transition to AI-owned state
- ignore AI-authored webhooks

Slice 3: safe Jira mutations

- AI-owned description section update
- edit progress comment
- terminal final comment
- assign back by configured role
- transition by configured outcome

Slice 4: product workflow automation

- discovery/design/test/release templates
- repo/PR integration
- Jira link and Confluence update actions
- richer status dashboards

## Open Risks

- Jira workflow transition ids are instance-specific. Use transition-name lookup
  plus configured aliases; do not hardcode ids in generic docs.
- Jira Server user identity fields differ by version/config. Verify whether the
  instance wants `name`, `key`, or another field before implementing assignee
  set.
- Jira webhook auth may need an internal gateway if the server cannot send
  custom bearer headers.
- AI account permissions must be explicit: Browse Project, Assign Issue, Edit
  Issue, Transition Issue, Add Comments, Edit Own Comments, and issue property
  access.
- Description updates can destroy human content if implemented as blind replace.
- Comment editing may require "edit own comments" or broader project permission.
- A PAT represents a powerful Jira user. Store it only in env/secret storage,
  never in prompt context or result payloads.
- Jira events triggered by AI's own writes can create loops if author filtering
  and issue lock checks are weak.
- Retrying non-idempotent Jira actions can duplicate comments or move issues
  incorrectly. Keep retry off until idempotency keys/state checks exist.

## Recommendation

This is a strong API-channel proof because Jira is not just chat. It needs
resource actions and stateful workflow control.

Recommended path:

1. Keep the API-channel MVP small, but make its action model capable of adding
   named resource actions later.
2. Build Jira as the first serious non-chat API bot after Chatwoot text flow.
3. Start with event intake + add comment + result polling.
4. Add issue property lock before assignee/transition automation.
5. Add assignee/transition only with explicit role/status config.
6. Add description/comment edit only with AI-owned sections and one progress
   comment id stored in issue property.

Do not implement the full AI ownership loop until the Jira workflow statuses,
role fields, AI account permissions, and webhook auth path are verified on the
actual Jira Server instance.
