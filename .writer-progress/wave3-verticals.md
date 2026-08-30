# wave3-verticals lane log (writer)

- 2026-08-28T02:12Z STEP 0: lane log created. Order: TASK 1 (TG callback_query approval) -> TASK 3 (Slack inbound files) -> TASK 2 (outbound media G7-G10+G11).
- 2026-08-28T02:12Z reading pre-mapped files: poll.ts, host.ts done; next: slack socket-mode.ts, slack web-api.ts, shared/media.ts, telegram media.ts, hub relay/index.ts, hub approvals tests.
- 2026-08-28T02:30Z COORDINATION: adopted .writer-progress/.tsgo.lock protocol (90s re-check, max ~8 retries) before npm run typecheck:node; vitest stays single-file --bail=1.
- 2026-08-28T02:30Z recon complete for TASK 1: poll.ts dispatchBatch is the hook point (per-update loop); slack's onInteractive seam (socket-mode.ts block_actions handler + start-account.ts slackApprovalInteractive wrapping channelRuntime.approvalAction) is the mirror; hub supervisor mounts approvalAction at supervisor/index.ts:877 reading {channel, accountId, senderIdentity, cardValue, externalConversationId, externalThreadId, rootKind}. plan: new transport/approval-callback.ts (shapes + parse + rootKind, mirrors slack approval-card.ts) + poll.ts wiring (dedupe by update_id, ack-first = silent answerCallbackQuery, dispatch to new onApprovalCallback option) + start-account.ts wiring + pollFn/fetchImpl test hooks. allowed_updates gains "callback_query" (wire change -> DEVIATIONS).
- 2026-08-28T02:45Z recon TASK 3: slack files payload on SlackMessageEvent (open record); fold point = socket-mode.ts handleEnvelope (mirror of poll.ts foldBatchEvent); download = fetch(files[].url, Bearer bot token), 10-min floor; manifest via shared buildAttachedFilesManifest; drop semantics fall out of L3 empty-body drop (TG parity). start-account passes ctx.mediaDownloadDir + botToken.
- 2026-08-28T02:55Z recon TASK 2: relay single choke point = RelayEngine.post (relay/index.ts) — plan media there (one ledger row per media post, contiguous sequence, text post stays last w/ threadLink); relay gains optional sendMedia fn from deps; supervisor builds mediaPostFor reading plugin.outbound.sendMedia (new vertical surface, mirrors postFor); caps + planner live in shared media.ts (one home); Telegram: TelegramApi gains sendPhoto/sendDocument/sendAudio/sendVoice/sendVideo/sendAnimation (grammy api), route by mime; Slack: WebClient gains files.getUploadURLExternal + files.completeUploadExternal (OpenClaw client-delivery.ts external-upload flow — recorded mapping), uploadSlackMediaFile in client/web-api.ts, sendSlackMedia in outbound.ts. Need: homeDir source for path gating (CLISBOT_HOME?), hub package.json gains @getpaseo/channels-shared dep.
- 2026-08-28T03:05Z ACK (coordinator re-scope): TASK 2 is VERTICALS-ONLY — no packages/hub edits (relay/index.ts + supervisor media touchpoint = wave3-hub lane). DRAFT CANCELLED (relay sendMedia fn / mediaPostFor / homeDir plumbing — not started). FINAL TASK 2 SCOPE: (1) verticals media-send functions, (2) shared helper extractLocalMediaPaths, (3) shared G11 caps+notice (one module), (4) additive shared plugin interface (SendMediaFn).
- 2026-08-28T03:05Z SEAM FOR HUB LANE (consume via plugin.outbound, mirrors postFor's sendText read):
  `plugin.outbound.sendMedia(args)` on BOTH verticals (additive `ChannelPlugin.outbound.sendMedia?: SendMediaFn` in packages/channels/shared/src/plugin.ts):
  args: { cfg, accountId, to, threadId?, filePath (absolute local path under the dev home), [key: string]: unknown }
  returns: { messageId: string; mediaPosted: boolean; [key: string]: unknown }
  - mediaPosted=true: native media post (TG sendPhoto/sendDocument/sendAudio/sendVoice/sendVideo/sendAnimation by mime; Slack files.getUploadURLExternal -> POST upload_url -> files.completeUploadExternal), sent-message seam recorded, returns the channel-native id.
  - mediaPosted=false (G11 policy reject: over cap TG 50MB / Slack 250MB, or unsupported ext): the vertical POSTS THE NOTICE ITSELF through its text path and returns that post's id. Notice wording (shared, media-policy.ts formatOutboundMediaNotice): "Could not post media <name>: too large (Telegram limit 50 MB)" / "...: too large (Slack limit 250 MB)" / "Could not post media <name>: unsupported format". Transport faults THROW (the hub lane's failDelivery owns them).
    Shared pure helper: `extractLocalMediaPaths(text, homeRoot)` in shared/src/media.ts sibling media-policy.ts ->
    { text: string; media: Array<{ filePath: string; fileName: string; mediaKind: "image"|"audio"|"video"|"document"; mime: string }> }
    — removes the whole candidate line from text (first line that is exactly a local abs path under homeRoot, existing regular file, media ext); keeps all other lines; caps + ext table + notice builder live in packages/channels/shared/src/media-policy.ts (one home).
- 2026-08-28T03:05Z STARTING TASK 1 (TG callback_query approval half).
- 2026-08-28T02:50Z TASK 1 (E2, TG callback_query approval half) IMPLEMENTED:
  - NEW packages/channels/telegram/src/transport/approval-callback.ts — TelegramCallbackQueryShape + parseApprovalCallbackClick (opaque callback_data, sender/root-chat/topic/message-id) + approvalCallbackRootKind (private→dm else group), mirroring slack transport/approval-card.ts.
  - poll.ts: TelegramUpdateShape.callback_query; resolveTelegramAllowedUpdates += "callback_query" AND the list is now SENT on the getUpdates URL (pinned monitor omitted the param → full-set default; the unused types — incl. unhandled callbacks — were advanced past; D-013 records this); dispatchBatch takes a seenUpdateIds Set (transport redelivery guard; Set.add returns the set — used has+add, the first draft had a truthiness bug caught by the dedupe test); dispatchApprovalCallback = silent answerCallbackQuery (POST, form body, no text/alert) THEN handoff; handoff fault logged, poll kept alive.
  - start-account.ts: telegramApprovalCallback wires ctx.channelRuntime.approvalAction → poll onApprovalCallback (mirror of slackApprovalInteractive).
  - Tests: poll.test.ts +4 (ack-first silent answer + raw handoff with exact URL/body assertions; re-served update_id NOT re-dispatched; no-seam → answered+dropped; callback throw → poll survives, abort on next batch) + NEW approval-callback.test.ts (4: full parse, root-omission, unactionable shapes, root-kind table). 18 tests green across 3 files (poll/approval-callback/start-account).
  - GATES GREEN: hub typecheck:node rc=0 (lock free at run), channels-telegram tsgo rc=0 (exactOptionalPropertyTypes fix: test helper uses Object.assign not spread-with-undefined), oxlint 0 on changed files, oxfmt applied.
  - DOCS: DEVIATIONS D-013 flipped to wired (+ allowed_updates wire change), SYNC.md poll.ts row + new approval-callback.ts row + start-account row.
    VERDICT TASK 1: DONE.
- 2026-08-28T02:50Z STARTING TASK 3 (Slack inbound files / F-06 G5+G6). Plan (recon-confirmed): NEW slack transport/media.ts mirroring telegram transport/media.ts (extract Slack files[]; skip external/unknown with logged skip; download via fetch(file.url, Bearer bot token), 10-min floor per file, into downloadDir with native file_name (fallback `<ts>-<i>-file`); shared buildAttachedFilesManifest + foldAttachedFilesIntoBody; media-only → manifest-only body (G6); all-fail → null body → L3 empty-body drop (G-parity, no new drop code)); socket-mode.ts handleEnvelope folds before onInbound (needs new options: downloadDir?, botToken?, fetchImpl? — but handleEnvelope is sync → make it await the fold, handler is already async); start-account.ts passes ctx.mediaDownloadDir + resolved botToken + logger.

## TASK 3 (F-06 Slack half / G5+G6): inbound `files[]` extraction — 2026-08-28

Implementation (all in the slack vertical + shared, zero hub edits):

- `packages/channels/shared/src/media.ts`: `downloadMediaFile` gains an optional
  `headers` param (Slack sends the Bearer bot token; TG URLs carry the token in
  the path); new `MEDIA_DOWNLOAD_TIMEOUT_MS` = 10-min floor, exported from
  `index.ts` (TG transport/media.ts now consumes the shared constant instead of
  a local copy).
- `packages/channels/slack/src/transport/media.ts` (NEW): `extractSlackFileAttachments`
  (download-URL preference `url_private_download ?? url_private`; mime→kind
  image/audio/video/document; external link files + non-Slack/https hosts are
  skips, not faults), `downloadSlackFile` (shared stream-to-disk, Bearer
  header, 10-min floor, native file name), `foldInboundSlackMedia` (skip-logs,
  ordered download, shared `[Attached files]` manifest folded into the body,
  media-only → manifest-only body (G6), all-failed → null → dropped, TG parity).
- `packages/channels/slack/src/transport/socket-mode.ts`: `options.media` — the
  fold runs in `handleEnvelope` BEFORE the L3 handoff (body must be final
  before dedupe/record); a drop is a silent envelope ack.
- `packages/channels/slack/src/lifecycle/start-account.ts`: `resolveMediaDownloadDir`
  (the `ctx.mediaDownloadDir` the Hub fills) → `options.media`.

Docs: DEVIATIONS D-007 (P0 trim: no audio preflight / fresh-URL refetch /
concurrency pool / maxBytes cap; shared download/manifest/body-fold DRY with TG;
host allowlist + Bearer + URL preference mirrored from OpenClaw monitor/media.ts).
SYNC.md rows updated; OUT OF SCOPE now "OUTBOUND media delivery".

Gate: hub typecheck:node rc=0 (tsgo lock, free first try); targeted lint rc=0
(2 errors fixed: unused `kind` param on sanitizeBase, `startSlackAccount`
complexity 22→extracted `createSlackL3Processor`); format applied; slack tests
26/26 (media.test.ts 14 + socket-mode.test.ts incl. 2 fold-through-transport);
shared media.test.ts 11/11; TG media.test.ts 14/14; all three vertical dists
rebuilt rc=0.

VERDICT TASK 3: DONE.

STARTING TASK 2 (verticals-only native media outbound + G11): shared
`extractLocalMediaPaths(text, homeRoot)` + one-home caps/notice module
(`packages/channels/shared/src/media-policy.ts`: TG 50MB / Slack 250MB + the
in-channel notice wording), TG sendPhoto/sendDocument/sendAudio/sendVoice/
sendVideo/sendAnimation + mime→method routing, Slack 3-step external upload
(getUploadURLExternal → POST → completeUploadExternal), `sendMedia` on both
verticals' outbound + plugin.ts (seam `plugin.outbound.sendMedia`, recorded
above for the hub lane). No packages/hub edits.

TASK 2 (verticals-only native media outbound + G11) — implementation done, gated.

Files:

- shared: src/media-policy.ts (NEW — caps + notice wording + mimeFromExtension
  - isSupportedMediaMime + evaluateOutboundMedia + extractLocalMediaPaths +
    mediaFileName; one home for TG 50MB / Slack 250MB + G11 notice text),
    src/media-policy.test.ts (NEW, 17 tests), src/plugin.ts (SendMediaFn type +
    outbound.sendMedia? on ChannelPlugin), src/index.ts (exports).
- telegram: src/client/bot-api.ts (TelegramApi +6 media methods;
  registerTelegramApiForTest / clearTelegramApiForTest token-keyed test seam),
  src/outbound-media.ts (NEW — telegramMediaMethod mime→method routing +
  sendTelegramMedia via withTelegramSendRetry + shared buildTelegramThreadParams),
  src/outbound-media.test.ts (NEW, 4 tests: routing table + native post),
  src/outbound.ts (sendMedia: G11 gate first → notice via sendText + mediaPosted
  false, else sendTelegramMedia + recordSentMessage), src/outbound.test.ts (NEW,
  2 tests: G11 notice path via fake API + missing-file throw),
  src/client/bot-api.test.ts (fake +6 media methods), src/plugin.ts
  (outbound.sendMedia = sendMedia).
- slack: src/client/web-api.ts (WebClientInstance +files: getUploadURLExternal /
  completeUploadExternal), src/outbound-media.ts (NEW — uploadSlackFile 3-step
  external upload + isSlackUploadUrl host allowlist + postUploadBytes),
  src/outbound-media.test.ts (NEW, 4 tests), src/outbound.ts (sendMedia: G11 gate
  first → notice via sendSlackText + mediaPosted false, else uploadSlackFile +
  recordSlackSentMessage keyed on file id), src/outbound.test.ts (+2 tests: G11
  notice + missing-file), src/client/web-api.test.ts (fake +files stub),
  src/plugin.ts (outbound.sendMedia = sendMedia).

Seam: plugin.outbound.sendMedia (both verticals); pure shared helper
extractLocalMediaPaths(text, homeRoot) for the hub lane to call; media-policy.ts
is the one home for caps + notice wording (G11).

OpenClaw mapping (recorded):

- TG: extensions/telegram/src/outbound-media.ts resolveTelegramOutboundMediaSenders
  - packages/media-core (mime-kind + EXT_BY_MIME) → telegramMediaMethod routing
    (gif→sendAnimation, image→sendPhoto, video→sendVideo, audio/ogg|opus→sendVoice,
    audio→sendAudio, else→sendDocument). photo→doc fallback ladder + forceDocument/
    asVoice/sendImageAsPhoto NOT ported (D-014).
- Slack: extensions/slack/src/client-delivery.ts uploadSlackFile (2026.7.1) →
  verbatim 3-step external upload; legacy files.upload + DNS-retry + redaction
  log NOT ported (D-008).

Gate: hub typecheck:node — all errors in packages/hub/src/channels/\*_ (the
concurrent hub lane's in-flight EffectiveDefaults/ChannelSupervisor changes);
ZERO errors in packages/channels/_ (my scope), none reference TASK-2 symbols.
lint rc=0 (fixed: unused `init` param in slack outbound-media.test.ts → \_init);
format applied; targeted tests green: shared media-policy 17 + media 11 = 28;
TG outbound-media 4 + outbound 2 + bot-api 17 = 23; slack outbound-media 4 +
outbound 10 + web-api 4 = 18. All three vertical dists rebuilt rc=0.
Docs: TG DEVIATIONS D-004 revised + D-014 new; TG SYNC rows (bot-api/outbound/
outbound-media/plugin). Slack DEVIATIONS D-008 new; Slack SYNC rows
(web-api/outbound/outbound-media/plugin) + OUT OF SCOPE line updated.

VERDICT TASK 2: DONE (verticals-only; no packages/hub edits).
