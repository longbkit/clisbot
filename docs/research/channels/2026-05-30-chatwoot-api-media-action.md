# Chatwoot API Media Action Thinking

Status: thinking for scope review. This is not part of the first API-channel
MVP unless explicitly accepted.

## Purpose

Clarify how `actions.message.send` would send images/files through Chatwoot if
we decide to include media delivery earlier than the generic API-channel MVP.

This doc answers:

- what the Chatwoot mapping should look like
- what config shape would be needed
- what runtime mechanism makes it work
- what is verified vs still risky
- whether this should be done now

## Verification Status

Local `/workspace/chatwoot` was not available in this runtime, so this pass used
a sparse clone of upstream `chatwoot/chatwoot` for source verification.

Evidence from upstream Chatwoot:

- `Api::V1::Accounts::Conversations::MessagesController#create` passes request
  params into `Messages::MessageBuilder`.
- `Messages::MessageBuilder` reads `params[:attachments]` and builds message
  attachments from an array.
- Chatwoot specs cover `attachments: [Rack::Test::UploadedFile.new(...)]`.
- Chatwoot message model allows up to `15` attachments per message.
- Chatwoot file type helper classifies `image/*`, `video/*`, `audio/*`, and
  generic file types.
- Swagger for create-message still documents JSON `content` as required and
  does not fully describe multipart attachment create behavior.

Implication: the likely API contract is Rails multipart form fields with
repeated `attachments[]`, but we should confirm against the actual Chatwoot fork
or a live local instance before committing implementation.

## Baseline Text Send

Current first-slice Chatwoot action stays JSON/text-only:

```json
{
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
        "private": false
      },
      "rendering": {
        "native": "markdown"
      },
      "retry": {
        "mode": "none"
      }
    }
  }
}
```

No top-level `outbound` should be added. Media remains an extension of the named
action model.

## Reply Mapping

Chatwoot media send does not need new inbound reply addressing fields. The
existing reply mapping is still enough:

```json
{
  "map": {
    "eventId": "message_created:{{$.id}}",
    "surfaceKind": "dm",
    "surfaceId": "{{$.account.id}}:{{$.conversation.id}}",
    "senderId": "$.sender.id",
    "senderDisplayName": "$.sender.name",
    "text": "$.content",
    "replyTargetId": "$.conversation.id",
    "replyParams": {
      "accountId": "$.account.id"
    }
  }
}
```

Interpretation:

- `reply.targetId` is the Chatwoot conversation id.
- `reply.params.accountId` is only provider-addressing metadata for the
  Chatwoot API URL.
- file/image/audio/video payloads come from the outbound clisbot message
  command, not from `reply.params`.
- `reply.params` must not be shown in prompt context and must not contain
  secrets.

## Proposed Multipart Action Config

If we support Chatwoot attachments, extend `actions.message.send` with a
multipart body mode:

```json
{
  "actions": {
    "message.send": {
      "method": "POST",
      "url": "{{env.CHATWOOT_BASE_URL}}/api/v1/accounts/{{reply.params.accountId}}/conversations/{{reply.targetId}}/messages",
      "headers": {
        "api_access_token": "{{env.CHATWOOT_API_ACCESS_TOKEN}}"
      },
      "bodyType": "multipart",
      "multipart": {
        "fields": {
          "content": "{{message.text}}",
          "message_type": "outgoing",
          "private": "false"
        },
        "files": [
          {
            "field": "attachments[]",
            "from": "{{message.files}}",
            "source": "localPath"
          }
        ]
      },
      "rendering": {
        "native": "markdown"
      },
      "retry": {
        "mode": "none"
      }
    }
  }
}
```

Notes:

- Use repeated `attachments[]` fields for multiple files.
- `private` is stringified because multipart form fields are strings.
- `message.text` is the shared caption/body for the Chatwoot message.
- `message.files` is a clisbot canonical outbound file array, not a provider
  payload passthrough.
- Do not support arbitrary multipart templates that can read local paths from
  inbound payloads. Files must come from explicit clisbot send input.

## Capability Declaration

Do not model this as one generic "supports files" boolean.

Proposed narrow Chatwoot capability if accepted:

```json
{
  "capabilities": {
    "message.send": true,
    "message.progress": true,
    "media": {
      "file": {
        "localPath": true,
        "remoteUrl": false,
        "multiple": "same_message",
        "caption": "shared_message"
      },
      "image": {
        "localPath": true,
        "remoteUrl": false,
        "multiple": "same_message",
        "caption": "shared_message"
      },
      "video": {
        "localPath": true,
        "remoteUrl": false,
        "multiple": "same_message",
        "caption": "shared_message"
      },
      "audio": {
        "localPath": true,
        "remoteUrl": false,
        "multiple": "same_message",
        "caption": "shared_message"
      },
      "voice": {
        "localPath": false,
        "remoteUrl": false,
        "multiple": "unsupported",
        "caption": "unsupported"
      }
    }
  }
}
```

Reasoning:

- Chatwoot classifies image/video/audio/file attachments, but does not expose a
  provider-neutral voice-note send contract here.
- Upstream builder accepts uploaded files or direct-upload signed ids; it does
  not treat arbitrary remote URLs as normal message attachments.
- Remote URL support should be a later feature with SSRF controls or a
  provider-specific direct-upload step.

## Operator Shape

Future operator example:

```bash
clisbot message send \
  --channel api \
  --bot chatwoot \
  --target dm:3:970 \
  --message "Anh xem file giup em." \
  --file /absolute/path/report.pdf
```

For an image:

```bash
clisbot message send \
  --channel api \
  --bot chatwoot \
  --target dm:3:970 \
  --message "Anh xem hinh nay." \
  --file /absolute/path/photo.png \
  --file-type image
```

`--file-type` is the existing clisbot flag. It accepts
`auto|file|image|video|audio|voice`, defaulting to `auto`. For the API channel,
reuse this existing command surface instead of inventing a new `--file-kind`
flag. The Chatwoot extension work is in teaching API actions how to consume the
existing `--file`/`--file-type` command data and render multipart
`attachments[]`.

## Runtime Mechanism

1. `message send` receives text plus one or more explicit local file paths.
2. Shared message layer normalizes each file into:

```json
{
  "path": "/absolute/path/photo.png",
  "fileName": "photo.png",
  "contentType": "image/png",
  "kind": "image",
  "sizeBytes": 123456
}
```

3. API channel checks declared media capability before dispatch.
4. Result store records the progress/final output first.
5. `actions.message.send` renderer builds multipart form fields.
6. For each file, renderer streams the local file under `attachments[]`.
7. Provider response is recorded on the output/action status if delivery status
   is added later; provider failure must not erase the stored result.

If no `actions.message.send` exists, the same message/file output should still
be recorded in result state, but media delivery should be marked unsupported by
capability validation for provider dispatch. Do not pretend that a local result
attachment means Chatwoot received the file.

## Provider Reality Check

Chatwoot accepting attachments is only the first boundary. The actual customer
experience depends on the Chatwoot inbox/channel behind the conversation:

- Web widget may show attached files normally.
- Telegram/WhatsApp/Line/SMS/etc. may have provider-specific restrictions.
- Some providers reject text plus attachments, multiple files, large files, or
  unsupported media types.
- Chatwoot may create the message record, then fail provider delivery later.

Therefore the first implementation should validate only what clisbot can know
locally and record provider delivery result separately when that status model is
added. It should not promise identical media rendering across all Chatwoot
inboxes.

## Inbound Attachment Mapping

Inbound Chatwoot attachments are a separate concern from outbound send. If we
need to expose inbound attachments later, the map can project them without
making them prompt-visible by default:

```json
{
  "attachments": {
    "from": "$.attachments",
    "map": {
      "id": "@.id",
      "fileName": "@.file_name",
      "contentType": "@.content_type",
      "fileType": "@.file_type",
      "url": "@.data_url"
    }
  }
}
```

This should not automatically download or render files into prompt context.
That needs separate attachment intake and media-understanding policy.

## Risks

High-signal risks before implementation:

- exact multipart field names must be verified on the current Chatwoot fork or
  live API
- Chatwoot API docs emphasize JSON create-message shape, while attachments are
  more evident from Rails source/specs
- remote URL attachments are not the same as uploaded files; downloading URLs
  inside clisbot opens SSRF, size, timeout, and malware-scanning questions
- local file paths must be explicit operator/agent outputs, not provider
  payload-derived paths
- attachment-only messages may work in code, but Swagger says `content` is
  required, so require text until live-tested
- multiple attachments appear supported up to 15, but downstream provider
  delivery may fail or split behavior may vary
- retries can duplicate messages/files, so keep `retry.mode: none` initially
- result store should persist metadata and provider response, not file bytes
- delivery status should eventually cover progress and final outputs
  consistently, not only final messages

## Recommendation

Do not add generic API-channel media delivery to the MVP by default.

If Chatwoot media is needed now, implement a narrow Chatwoot-oriented slice:

- only `actions.message.send`
- only `bodyType: "multipart"`
- only explicit local files
- repeated `attachments[]`
- text required
- no remote URL download
- no retry
- no voice-note special case
- test one file and multiple files against the current Chatwoot fork/live API
- keep result-store recording independent from provider delivery success

This gives useful Chatwoot image/file delivery without widening the API channel
into a general media transport framework too early.

## Open Grill Questions

1. Do we need Chatwoot file/image send in the first implementation, or is
   text-only enough for the MVP?
   Recommendation: keep out of MVP unless there is an immediate Chatwoot use
   case that depends on files.
2. Should first Chatwoot media support one file only or repeated
   `attachments[]`?
   Recommendation: implement repeated `attachments[]` only after live test; if
   not tested, ship one file first.
3. Should clisbot accept remote URLs for Chatwoot media?
   Recommendation: no. Add remote URLs only with explicit download/staging SSRF
   controls or a Chatwoot direct-upload signed-id flow.
4. Should attachment-only messages be allowed?
   Recommendation: no for first slice; require `message.text` until the current
   Chatwoot API is live-tested.
5. Should this be a Chatwoot-specific hardcoded adapter or generic multipart
   action support?
   Recommendation: implement generic multipart action rendering only if it stays
   small and declarative. Keep Chatwoot-specific capability examples in config,
   not as a separate `chatwoot.sendFile` action.

## Related Docs

- [Generic API Channel MVP](../../tasks/features/channels/2026-05-27-generic-webhook-channel-mvp.md)
- [Generic API Channel Events And Actions Grill](2026-05-25-generic-webhook-channel-grill.md)
- [API Channel Result Polling Grill](2026-05-30-api-channel-result-polling-grill.md)
- [Generic API Channel Events And Actions ADR](../../architecture/decisions/2026-05-25-generic-webhook-channel-connectors.md)
