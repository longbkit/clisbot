# Zalo Personal Friend Invites And Message Backfill Implementation Notes

## Scope

This note records live implementation details for
[Zalo Personal Contacts, Groups, And Full Tool Surface](2026-05-18-zalo-personal-contacts-groups-and-full-tool-surface.md).
Keep operator-facing guidance in
[Zalo Personal](../../../user-guide/zalo-personal.md).

## Findings

- zca-js `getSentFriendRequest` calls `/api/friend/requested/list`.
- zca-js documents Zalo code `112` as a possible empty sent-request list.
- clisbot normalizes code `112` to `sent: {}` so
  `contacts friend-invites list --direction sent|all` stays readable.
- Incoming friend requests come from `getFriendRecommendations()` entries where
  `dataInfo.recommType` is `2`.
- `listener.requestOldMessages(ThreadType.User)` can return global user-message
  backfill via `old_messages`, but it is not a target-specific history API.
- Live validation on 2026-05-23 saw an outgoing non-friend DM from Clisbot to
  Zalo Long in `old_messages` with content `Hi`.
- The earlier missing message was explained by timing: it was sent from the
  mobile app outside clisbot before the Zalo Personal session was logged in and
  listening.
- Incoming stranger DM was still not visible in listener logs, contact search,
  incoming friend invites, or shared `message read`.

## Attachment URL Decision

- Shared `message send --file <path-or-url>` keeps the cross-channel operator
  contract: the caller gives one file path or URL, and clisbot sends that file.
- zca-js `sendMessage({ attachments })` and `uploadAttachment()` do not treat a
  string attachment as a remote URL. They treat it as a local filesystem path,
  so passing `https://...` directly fails with `File not found`.
- clisbot therefore resolves both local paths and remote URLs into one
  zca-js `AttachmentSource` buffer object before upload. The shared helper is
  `src/channels/zalo-personal/attachment-source.ts`.
- `message send --file` and channel-native `messages upload --file` both use
  that helper, so filename, content-type fallback, download size checks, and
  local-file handling stay consistent.
- zca-js also exposes direct URL APIs for specific media:
  `sendVoice({ voiceUrl })` and
  `sendVideo({ videoUrl, thumbnailUrl, duration, width, height })`.
  These are not the default for generic shared `--file` sends because they do
  not cover normal files, require media-specific metadata, and may require URLs
  that Zalo can fetch directly.
- Current decision: use download-then-upload for shared `--file <path-or-url>`.
  Keep direct URL send APIs as channel-native/specialized paths. `--file-type
  voice` is the exception after upload: clisbot uploads the audio, gets a Zalo
  file URL, then calls `sendVoice` so the client displays a voice note.
- Video thumbnail note: shared `message send --file --file-type video` uses
  zca-js `sendMessage({ attachments })`, which sends through the generic
  attachment flow and does not pass an explicit thumbnail URL in the final send
  payload. Live validation showed the Zalo client may initially display a black
  thumbnail until playback starts. For thumbnail-sensitive video sends, use the
  channel-native `messages video send` path, which uploads the video and
  thumbnail, then calls zca-js `sendVideo`.

## Test Coverage

- Unit: `test/zalo-personal/operator-cli.test.ts`
  - `friend invite list treats Zalo code 112 as an empty sent list`
- Live checks used:
  - `clisbot-dev contacts friend-invites list --channel zalo-personal --bot default --direction sent --json`
  - `clisbot-dev contacts friend-invites list --channel zalo-personal --bot default --direction all --json`
  - a short zca-js listener script calling
    `listener.requestOldMessages(ThreadType.User)` and inspecting
    `old_messages`
- Live Zalo Personal attachment checks on 2026-05-23:
  - local image, local file, local audio, local video, and voice note sends
    succeeded
  - image URL and file URL sends succeeded after clisbot downloaded the URL and
    uploaded the buffer to Zalo
  - video URL send succeeded after clisbot downloaded the URL and uploaded the
    buffer to Zalo
  - channel-native URL upload returned raw `fileUrl`/`fileId`
  - channel-native styled text and link preview sends were confirmed by
    recipient screenshot
  - channel-native direct video send returned a Zalo `msgId` after uploading a
    separate thumbnail
  - channel-native direct video send with a JPEG/RGB thumbnail was confirmed by
    recipient screenshot; the thumbnail preview rendered before playback
  - repeated shared `--file` is rejected until multi-file semantics are designed

## Current Constraint

Do not expose `message read --target dm:<id>` for Zalo Personal from
`requestOldMessages` yet. A production-ready implementation needs filtering by
target, pagination/last-message handling, stale-window behavior, and tests that
separate messages sent before login from messages visible after login.

Do not make zca-js direct video URL send the default for
`message send --file --file-type video` until live tests prove the expected URL,
thumbnail, duration, dimensions, and client display behavior. Use the shared
download-then-upload path for the generic file contract, and keep explicit
thumbnail control in channel-native video send until that behavior is stable.
