# API Channel

## Purpose

The API channel lets an external system call `clisbot` over HTTP, route a
mapped event into an agent session, poll the result, stop active work, and
optionally send the agent response back to the source system.

Use it when the source is not a native clisbot channel, for example:

- local scripts and tests
- Chatwoot webhooks
- Jira Data Center webhooks
- Jira Cloud automation or webhooks
- internal product workflow automation

## Mental Model

One API bot is one webhook contract.

The bot owns:

- ingress auth
- filter rules
- payload-to-clisbot mapping
- route admission
- optional outbound `actions.message.send`

The main objects are:

- `eventId`: event/result id. If omitted or mapped to an empty value, clisbot
  generates `String(Date.now())` and returns it in the accept response.
- `surfaceKind`: `dm` or `group`.
- `surfaceId`: the conversation identity that chooses the agent session.
- `senderId`: external user id, used for auth policy.
- `text`: prompt sent to the agent.
- `replyTargetId` and `replyParams`: stored reply metadata for outbound
  `message.send`.

`eventId` is for dedup, result polling, and event stop. It does not choose the
agent session. The session is chosen by `surfaceKind + surfaceId`, plus the
global DM session scope.

Prefer URL-friendly `eventId` values such as `message-created-123`, not
`message_created:123`, because event ids appear in result and stop URLs.

## Endpoints

```text
POST /api/bots/<botId>/events
GET  /api/bots/<botId>/events/<eventId>/result
POST /api/bots/<botId>/events/<eventId>/stop
POST /api/bots/<botId>/surfaces/<surfaceId>/stop
```

Accepted event response:

```json
{
  "channel": "api",
  "botId": "local",
  "eventId": "1780150324414",
  "status": "queued",
  "resultUrl": "/api/bots/local/events/1780150324414/result",
  "expiresAt": "2026-05-30T20:12:04.418Z"
}
```

## Local Test

Example config:

```json
{
  "bots": {
    "api": {
      "defaults": {
        "enabled": true,
        "defaultBotId": "local",
        "listener": { "host": "127.0.0.1", "port": 8787 },
        "dmPolicy": "allowlist",
        "groupPolicy": "allowlist",
        "directMessages": {},
        "groups": {}
      },
      "local": {
        "enabled": true,
        "name": "local",
        "agentId": "default",
        "dmPolicy": "allowlist",
        "directMessages": {
          "*": {
            "enabled": true,
            "requireMention": false,
            "policy": "open",
            "allowUsers": [],
            "blockUsers": [],
            "allowBots": false
          }
        },
        "ingress": {
          "successStatusCode": 202,
          "auth": { "mode": "none" },
          "map": {
            "surfaceKind": "dm",
            "surfaceId": "{{$.senderId}}-{{$.surfaceId}}",
            "senderId": "$.senderId",
            "senderDisplayName": "$.senderName",
            "text": "$.text",
            "replyTargetId": "$.surfaceId",
            "replyParams": { "source": "local" }
          }
        },
        "actions": {}
      }
    }
  }
}
```

Start or restart:

```bash
clisbot restart
clisbot status
```

Post an event:

```bash
BASE=http://127.0.0.1:8787
A=$(curl -sS -X POST "$BASE/api/bots/local/events" \
  -H 'content-type: application/json' \
  -d '{"surfaceId":"1","senderId":"longluong","senderName":"A Long","text":"1+2"}')
echo "$A" | jq .
URL=$(echo "$A" | jq -r .resultUrl)
```

Poll result:

```bash
while true; do
  R=$(curl -sS "$BASE$URL")
  echo "$R" | jq .
  [ "$(echo "$R" | jq -r .status)" = completed ] && break
  sleep 1
done
```

Write progress or final manually:

```bash
EID=$(echo "$A" | jq -r .eventId)
clisbot message send \
  --channel api \
  --bot local \
  --target dm:longluong-1 \
  --reply-to "$EID" \
  --final \
  --message "local final ok"
```

## Expose The Listener

### Same Host Only

Keep the listener on loopback:

```json
{ "listener": { "host": "127.0.0.1", "port": 8787 } }
```

Use `auth.mode: "none"` only here. The `none` mode is loopback-only.

### Another Machine On The Same Network

Bind the listener to all interfaces and use bearer or HMAC auth:

```json
{
  "listener": { "host": "0.0.0.0", "port": 8787 }
}
```

Then allow the port through the host firewall only from trusted source IPs.

Example bearer auth:

```json
{
  "auth": {
    "mode": "bearer",
    "tokenEnv": "CLISBOT_API_TOKEN",
    "header": "authorization",
    "scheme": "Bearer"
  }
}
```

Client request uses the same `POST /api/bots/<botId>/events` path with an
`authorization: Bearer <token>` header.

### Public IP

Do not expose `auth.mode: "none"` publicly.

Recommended shape:

- keep clisbot on `127.0.0.1:8787`
- put Nginx, Caddy, Cloudflare Tunnel, Tailscale Funnel, or another gateway in
  front
- terminate HTTPS at the gateway
- forward only `/api/bots/...`
- use bearer or HMAC auth
- add gateway allowlists or provider IP allowlists when practical

Minimal Nginx example:

```nginx
server {
  listen 443 ssl;
  server_name clisbot-api.example.com;

  location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

Provider URL:

```text
https://clisbot-api.example.com/api/bots/<botId>/events
```

## Auth Modes

Bearer:

```json
{
  "auth": {
    "mode": "bearer",
    "tokenEnv": "CLISBOT_CHATWOOT_TOKEN"
  }
}
```

HMAC:

```json
{
  "auth": {
    "mode": "hmac",
    "secretEnv": "CLISBOT_CHATWOOT_WEBHOOK_SECRET",
    "timestampHeader": "x-chatwoot-timestamp",
    "signatureHeader": "x-chatwoot-signature",
    "signaturePrefix": "sha256=",
    "signingBase": "{{timestamp}}.{{rawBody}}",
    "toleranceSecondsDefault": 300
  }
}
```

Jira Data Center HMAC style, where the provider signs the raw body:

```json
{
  "auth": {
    "mode": "hmac",
    "secretEnv": "CLISBOT_JIRA_WEBHOOK_SECRET",
    "signatureHeader": "x-hub-signature",
    "signaturePrefix": "sha256=",
    "signingBase": "{{rawBody}}"
  }
}
```

Use bearer behind a gateway when a provider cannot sign the raw body or cannot
set the headers you need.

## Mapping And Filters

Paths use a small JSONPath-like subset:

- `$.field`
- `$.nested.field`
- `$["field with spaces"]`
- `$.items[0].id`
- `@.field` inside projections

Templates use `{{...}}`:

```json
{
  "surfaceId": "{{$.account.id}}-{{$.conversation.id}}",
  "text": "{{$.event}} {{$.content}}"
}
```

Supported filter operators: `all`, `any`, `not`, `equals`, `notEquals`,
`exists`, `in`, and `anyIn`.

## Chatwoot Webhook And Two-Way Response

Chatwoot can send account webhooks for events such as `message_created`.
Chatwoot also exposes an account API to create a new outgoing message in a
conversation.

Set these env vars:

```bash
export CLISBOT_CHATWOOT_WEBHOOK_SECRET=...
export CHATWOOT_BASE_URL=https://app.chatwoot.com
export CHATWOOT_API_ACCESS_TOKEN=...
```

Config:

```json
{
  "bots": {
    "api": {
      "defaults": {
        "enabled": true,
        "defaultBotId": "chatwoot",
        "listener": { "host": "127.0.0.1", "port": 8787 },
        "dmPolicy": "allowlist",
        "groupPolicy": "allowlist",
        "directMessages": {},
        "groups": {}
      },
      "chatwoot": {
        "enabled": true,
        "agentId": "default",
        "dmPolicy": "allowlist",
        "directMessages": {
          "*": {
            "enabled": true,
            "requireMention": false,
            "policy": "open",
            "allowUsers": [],
            "blockUsers": [],
            "allowBots": false
          }
        },
        "ingress": {
          "successStatusCode": 202,
          "auth": {
            "mode": "hmac",
            "secretEnv": "CLISBOT_CHATWOOT_WEBHOOK_SECRET",
            "timestampHeader": "x-chatwoot-timestamp",
            "signatureHeader": "x-chatwoot-signature",
            "signaturePrefix": "sha256=",
            "signingBase": "{{timestamp}}.{{rawBody}}",
            "toleranceSecondsDefault": 300
          },
          "filter": {
            "all": [
              { "path": "$.event", "equals": "message_created" },
              { "path": "$.message_type", "equals": "incoming" }
            ]
          },
          "map": {
            "eventId": "message-created-{{$.id}}",
            "surfaceKind": "dm",
            "surfaceId": "{{$.account.id}}-{{$.conversation.id}}",
            "senderId": "$.sender.id",
            "senderDisplayName": "$.sender.name",
            "text": "$.content",
            "replyTargetId": "$.conversation.id",
            "replyParams": {
              "accountId": "$.account.id"
            }
          }
        },
        "actions": {
          "message.send": {
            "method": "POST",
            "url": "{{env.CHATWOOT_BASE_URL}}/api/v1/accounts/{{reply.params.accountId}}/conversations/{{reply.targetId}}/messages",
            "headers": {
              "api_access_token": "{{env.CHATWOOT_API_ACCESS_TOKEN}}"
            },
            "body": {
              "content": "{{message.text}}",
              "message_type": "outgoing",
              "private": false,
              "content_type": "text"
            },
            "rendering": { "native": "markdown" },
            "retry": { "mode": "none" }
          }
        }
      }
    }
  }
}
```

Chatwoot setup:

1. Go to Settings -> Integrations -> Webhooks.
2. Add a webhook URL:
   `https://clisbot-api.example.com/api/bots/chatwoot/events`.
3. Select `message_created`.
4. Copy the webhook secret into `CLISBOT_CHATWOOT_WEBHOOK_SECRET`.
5. Restart clisbot.

When the agent replies, it should use:

```bash
clisbot message send \
  --channel api \
  --bot chatwoot \
  --target dm:<surfaceId> \
  --reply-to <eventId> \
  --final \
  --message "Done"
```

`--reply-to` updates the polled result. The configured `message.send` action
also sends an outgoing Chatwoot message.

## Jira Data Center Webhook

Jira Data Center webhooks are configured in Administration -> System ->
WebHooks. Jira Data Center supports secret-token/HMAC-style webhook security.

Config:

```json
{
  "jira-dc": {
    "enabled": true,
    "agentId": "default",
    "groupPolicy": "open",
    "groups": {
      "*": {
        "enabled": true,
        "requireMention": false,
        "policy": "open",
        "allowUsers": [],
        "blockUsers": [],
        "allowBots": false
      }
    },
    "ingress": {
      "successStatusCode": 202,
      "auth": {
        "mode": "hmac",
        "secretEnv": "CLISBOT_JIRA_DC_WEBHOOK_SECRET",
        "signatureHeader": "x-hub-signature",
        "signaturePrefix": "sha256=",
        "signingBase": "{{rawBody}}"
      },
      "filter": {
        "any": [
          { "path": "$.webhookEvent", "equals": "jira:issue_created" },
          { "path": "$.webhookEvent", "equals": "jira:issue_updated" }
        ]
      },
      "map": {
        "eventId": "jira-issue-{{$.issue.id}}-{{$.timestamp}}",
        "surfaceKind": "group",
        "surfaceId": "{{$.issue.key}}",
        "senderId": "$.user.name",
        "senderDisplayName": "$.user.displayName",
        "text": "Jira {{$.webhookEvent}} {{$.issue.key}} status={{$.issue.fields.status.name}} summary={{$.issue.fields.summary}}",
        "replyTargetId": "$.issue.key",
        "replyParams": {
          "issueKey": "$.issue.key",
          "projectKey": "$.issue.fields.project.key",
          "status": "$.issue.fields.status.name"
        }
      }
    },
    "actions": {}
  }
}
```

Jira Data Center setup:

1. Create the API bot config under `bots.api["jira-dc"]`.
2. Expose clisbot with HTTPS.
3. In Jira, go to Administration -> System -> WebHooks.
4. Add URL: `https://clisbot-api.example.com/api/bots/jira-dc/events`.
5. Select issue create/update events and narrow by JQL if needed.
6. Configure the webhook secret and set the same value in
   `CLISBOT_JIRA_DC_WEBHOOK_SECRET`.
7. Restart clisbot.

This is ingress-only by default. Let the agent use Jira MCP/CLI or a separate
approved tool to comment, transition, or update Jira.

## Jira Cloud Webhook Or Automation

For Jira Cloud, prefer an Automation rule with "Send web request" when you need
custom headers. Built-in webhooks and app webhooks can be enough for ingress,
but header/signature capabilities depend on the Jira feature path you use.

Bearer-auth config:

```json
{
  "jira-cloud": {
    "enabled": true,
    "agentId": "default",
    "groupPolicy": "open",
    "groups": {
      "*": {
        "enabled": true,
        "requireMention": false,
        "policy": "open",
        "allowUsers": [],
        "blockUsers": [],
        "allowBots": false
      }
    },
    "ingress": {
      "successStatusCode": 202,
      "auth": {
        "mode": "bearer",
        "tokenEnv": "CLISBOT_JIRA_CLOUD_WEBHOOK_TOKEN"
      },
      "filter": {
        "any": [
          { "path": "$.webhookEvent", "equals": "jira:issue_created" },
          { "path": "$.webhookEvent", "equals": "jira:issue_updated" },
          { "path": "$.issue_event_type_name", "equals": "issue_created" },
          { "path": "$.issue_event_type_name", "equals": "issue_updated" }
        ]
      },
      "map": {
        "eventId": "jira-cloud-{{$.issue.id}}-{{$.timestamp}}",
        "surfaceKind": "group",
        "surfaceId": "{{$.issue.key}}",
        "senderId": "$.user.accountId",
        "senderDisplayName": "$.user.displayName",
        "text": "Jira Cloud {{$.issue.key}} {{$.issue.fields.summary}}",
        "replyTargetId": "$.issue.key",
        "replyParams": {
          "issueKey": "$.issue.key",
          "projectKey": "$.issue.fields.project.key"
        }
      }
    },
    "actions": {}
  }
}
```

Automation setup:

1. Create or edit an automation rule.
2. Choose a trigger such as Issue created or Issue transitioned.
3. Add action: Send web request.
4. URL: `https://clisbot-api.example.com/api/bots/jira-cloud/events`.
5. Method: `POST`.
6. Header: `authorization: Bearer <token>`.
7. Body: Jira issue payload or custom JSON that matches your mapping.
8. Restart clisbot after config changes.

If you use Jira Cloud app webhooks instead of Automation, verify which fields
and headers are actually delivered in your tenant, then adapt `filter` and
`map`.

## Route And Session Choices

API route ids use:

- `dm:<surfaceId>`
- `dm:*`
- `group:<surfaceId>`
- `group:*`

Stored config keys are raw ids plus `*`.

Use one session per external conversation:

```json
"surfaceId": "{{$.account.id}}-{{$.conversation.id}}"
```

Use one session per event or message:

```json
"surfaceId": "message-{{$.id}}"
```

Use one session per Jira issue:

```json
"surfaceId": "{{$.issue.key}}"
```

Open a dynamic DM route:

```bash
clisbot routes add --channel api dm:* --bot chatwoot --policy open
```

Admit all Jira issue groups:

```bash
clisbot routes add --channel api group:* --bot jira-cloud --policy open
```

## Stop Active Work

Stop by event:

```bash
curl -sS -X POST "$BASE/api/bots/local/events/$EID/stop"
```

Stop whatever is currently active for a surface:

```bash
curl -sS -X POST "$BASE/api/bots/local/surfaces/longluong-1/stop"
```

Stopping a completed event returns an error. Stopping an active event uses the
same interruption path as other channels.

## Operational Checks

```bash
clisbot status
clisbot logs --lines 100
clisbot runner list
clisbot inspect --latest
```

For local curl tests, always print both the accept response and the poll result.

## FAQ

### Why did I get `invalid_mapping`?

The mapper could not produce a required field such as `surfaceKind`,
`surfaceId`, `senderId`, or `text`. `eventId` is optional; the other core fields
are not.

### Why did my event route to the wrong session?

Check `surfaceKind` and `surfaceId`. `eventId` does not pick the agent session.

### Should I map `surfaceId` to conversation id or message id?

Use conversation id when you want continuity. Use message id when every message
should be isolated.

### Can I use `auth.mode: "none"` for public webhooks?

No. Use it only on loopback. Public or LAN exposure should use bearer or HMAC,
preferably behind HTTPS and a gateway.

### Why did the second POST with the same event id not run again?

`eventId` is deduped per bot. If the first POST used the wrong payload, send a
new event id or omit `eventId` so clisbot generates one.

### Why did `message send --channel api` update the result but not Chatwoot?

The bot has no `actions.message.send` action configured, or the provider action
returned a non-2xx status. Check the command output and `clisbot logs`.

### Can API channel send files or images?

Not in the first slice. API `message.send` stores and sends text/Markdown only.

### How long are results kept?

The current result store keeps API results for a bounded retention window.
Treat result polling as short-lived workflow state, not a permanent archive.

## References

- Atlassian Jira Data Center webhooks:
  https://confluence.atlassian.com/adminjiraserver/managing-webhooks-938846912.html
- Atlassian Jira Cloud webhooks:
  https://developer.atlassian.com/cloud/jira/software/webhooks/
- Chatwoot webhook events:
  https://www.chatwoot.com/docs/product/others/webhook-events
- Chatwoot webhook signing:
  https://www.chatwoot.com/hc/user-guide/articles/1677693021-how-to-use-webhooks
- Chatwoot create conversation message API:
  https://developers.chatwoot.com/api-reference/messages/create-new-message
