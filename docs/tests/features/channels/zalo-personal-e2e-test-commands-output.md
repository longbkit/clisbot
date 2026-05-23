# Zalo Personal E2E Test Commands Output

## Masking

| Placeholder | Meaning |
| --- | --- |
| `[ZALO_LONG_USER_ID]` | Zalo Long raw user id |
| `[ZALO_CLISBOT_USER_ID]` | Zalo Clisbot raw user id |
| `[MASKED_AVATAR_URL]` | Zalo avatar URL |
| `[MASKED_GLOBAL_ID]` | Zalo global id |
| `[MASKED_MESSAGE_ID]` | Zalo message id |
| `[MASKED_CLIENT_MESSAGE_ID]` | Zalo client message id |
| `[MASKED_TIMESTAMP]` | Zalo timestamp |

## Friend Invite Discovery

| Command | Output | Note |
| --- | --- | --- |
| <pre><code class="language-bash">clisbot-dev contacts friend-invites list --channel zalo-personal --bot default --direction sent --json</code></pre> | <pre><code class="language-json">{<br>  "sent": {}<br>}</code></pre> | Before sending request |
| <pre><code class="language-bash">clisbot-dev contacts friend-invites list --channel zalo-personal --bot default --direction all --json</code></pre> | <pre><code class="language-json">{<br>  "sent": {},<br>  "incoming": []<br>}</code></pre> | Before sending request |
| <pre><code class="language-bash">clisbot-dev contacts friend-invites status --channel zalo-personal --bot default [ZALO_LONG_USER_ID] --json</code></pre> | <pre><code class="language-json">{<br>  "addFriendPrivacy": 0,<br>  "isSeenFriendReq": false,<br>  "is_friend": 0,<br>  "is_requested": 0,<br>  "is_requesting": 0<br>}</code></pre> | Before sending request |
| <pre><code class="language-bash">clisbot-dev contacts friend-invites status --channel zalo-personal --bot default [ZALO_LONG_USER_ID] --json</code></pre> | <pre><code class="language-json">{<br>  "addFriendPrivacy": 0,<br>  "isSeenFriendReq": false,<br>  "is_friend": 0,<br>  "is_requested": 1,<br>  "is_requesting": 0<br>}</code></pre> | After sending request |
| <pre><code class="language-bash">clisbot-dev contacts friend-invites list --channel zalo-personal --bot default --direction sent --json</code></pre> | <pre><code class="language-json">{<br>  "sent": {<br>    "[ZALO_LONG_USER_ID]": {<br>      "userId": "[ZALO_LONG_USER_ID]",<br>      "zaloName": "Long",<br>      "displayName": "Long",<br>      "avatar": "[MASKED_AVATAR_URL]",<br>      "globalId": "[MASKED_GLOBAL_ID]",<br>      "bizPkg": {<br>        "pkgId": 0<br>      },<br>      "fReqInfo": {<br>        "message": "",<br>        "src": 30,<br>        "time": 1779549202<br>      },<br>      "isEnterpriseAccount": 0<br>    }<br>  }<br>}</code></pre> | After sending request |

## Friend Invite Mutation

| Command | Output | Note |
| --- | --- | --- |
| <pre><code class="language-bash">clisbot-dev contacts friend-invites send --channel zalo-personal --bot default --user [ZALO_LONG_USER_ID] --confirm --json</code></pre> | <pre><code class="language-json">[<br>  {<br>    "userId": "[ZALO_LONG_USER_ID]",<br>    "response": ""<br>  }<br>]</code></pre> | Sends friend request |

## Contact Discovery

| Command | Output | Note |
| --- | --- | --- |
| <pre><code class="language-bash">clisbot-dev contacts search --channel zalo-personal --bot default Long --json</code></pre> | <pre><code class="language-json">[]</code></pre> | Non-friend not found by search |

## Message History Checks

| Command | Output | Note |
| --- | --- | --- |
| <pre><code class="language-bash">clisbot-dev message read --channel zalo-personal --bot default --target dm:[ZALO_CLISBOT_USER_ID] --limit 5 --json</code></pre> | <pre><code class="language-text">error zca-js exposes group chat history only; Zalo Personal DM read is not supported by the current API.<br>Help: clisbot-dev --help<br>Docs: docs/user-guide/README.md<br>If you still need help: clone https://github.com/longbkit/clisbot, open it in Codex or Claude Code, and ask for setup help.</code></pre> | DM read unsupported |
| <pre><code class="language-bash">bun -e 'import { loginZaloPersonalFromSession } from "./src/channels/zalo-personal/zca-js.ts"; const client = await loginZaloPersonalFromSession("/home/node/.clisbot-dev/credentials/zalo-personal/default/auth-session"); const rows = []; let requested = false; function summarize(m, source, type) { const d = m?.data ?? {}; let content = d.content; if (typeof content !== "string") content = JSON.stringify(content ?? ""); rows.push({ source, threadType: type, isSelf: Boolean(m?.isSelf), threadId: String(m?.threadId ?? ""), uidFrom: String(d.uidFrom ?? ""), idTo: String(d.idTo ?? ""), msgId: String(d.msgId ?? ""), cliMsgId: String(d.cliMsgId ?? ""), ts: d.ts ?? null, dName: d.dName ?? null, content: String(content ?? "").slice(0, 200) }); } function request() { if (requested) return; requested = true; client.api.listener.requestOldMessages(client.ThreadType.User); } client.api.listener.on("connected", request); client.api.listener.on("message", (m) => summarize(m, "message", m.type)); client.api.listener.on("old_messages", (msgs, type) => { for (const m of msgs ?? []) summarize(m, "old_messages", type); }); client.api.listener.on("error", (e) => console.error("listener-error", e?.message ?? e)); client.api.listener.start({ retryOnClose: false }); setTimeout(request, 1000); await new Promise((resolve) => setTimeout(resolve, 6000)); try { client.api.listener.stop(); } catch {} console.log(JSON.stringify(rows.slice(0, 50), null, 2));'</code></pre> | <pre><code class="language-json">[<br>  {<br>    "source": "old_messages",<br>    "threadType": 0,<br>    "isSelf": true,<br>    "threadId": "[ZALO_LONG_USER_ID]",<br>    "uidFrom": "[ZALO_CLISBOT_USER_ID]",<br>    "idTo": "[ZALO_LONG_USER_ID]",<br>    "msgId": "[MASKED_MESSAGE_ID]",<br>    "cliMsgId": "[MASKED_CLIENT_MESSAGE_ID]",<br>    "ts": "[MASKED_TIMESTAMP]",<br>    "dName": "Clisbot",<br>    "content": "Hi"<br>  }<br>]</code></pre> | Outgoing non-friend DM backfill |
