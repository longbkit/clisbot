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
| `[MASKED_FILE_ID]` | Zalo uploaded file id |
| `[MASKED_FILE_URL]` | Zalo uploaded file URL |
| `[MASKED_CHECKSUM]` | Uploaded file checksum |

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

## Message Send

| Command | Output | Note |
| --- | --- | --- |
| <pre><code class="language-bash">clisbot-dev message send --channel zalo-personal --bot default --target dm:[ZALO_LONG_USER_ID] --message "Test từ clisbot-dev lúc 2026-05-23 15:45 UTC. Anh confirm giúp em nhận được không." --json</code></pre> | <pre><code class="language-json">{<br>  "message": {<br>    "msgId": "[MASKED_MESSAGE_ID]"<br>  },<br>  "attachment": []<br>}</code></pre> | Sends DM to non-friend user |
| ``clisbot-dev message send --channel zalo-personal --bot default --target dm:[ZALO_LONG_USER_ID] --message $'**Rich text test** từ clisbot-dev\n- Bold markdown\n- Link: https://example.com\n`inline code`' --render native --json`` | <pre><code class="language-json">{<br>  "message": {<br>    "msgId": "[MASKED_MESSAGE_ID]"<br>  },<br>  "attachment": []<br>}</code></pre> | Rendered bold, bullets, link; inline code stayed visible as backtick text |
| <pre><code class="language-bash">clisbot-dev message send --channel zalo-personal --bot default --target dm:[ZALO_LONG_USER_ID] --message "Image attachment test từ clisbot-dev" --file /tmp/clisbot-zalo-e2e/zalo-personal-image-test.png --file-type image --json</code></pre> | <pre><code class="language-json">{<br>  "message": null,<br>  "attachment": [<br>    {<br>      "msgId": "[MASKED_MESSAGE_ID]"<br>    }<br>  ]<br>}</code></pre> | Image caption delivered with image |
| <pre><code class="language-bash">clisbot-dev message send --channel zalo-personal --bot default --target dm:[ZALO_LONG_USER_ID] --message "Plain file attachment final pass" --file /tmp/clisbot-zalo-e2e/zalo-personal-file-test.txt --file-type file --json</code></pre> | <pre><code class="language-json">{<br>  "message": {<br>    "msgId": "[MASKED_MESSAGE_ID]"<br>  },<br>  "attachment": [<br>    {<br>      "msgId": "[MASKED_MESSAGE_ID]"<br>    }<br>  ]<br>}</code></pre> | File attachment requires upload listener callback |
| <pre><code class="language-bash">clisbot-dev message send --channel zalo-personal --bot default --target dm:[ZALO_LONG_USER_ID] --message "Audio attachment final pass" --file /tmp/clisbot-zalo-e2e/zalo-personal-audio-test.wav --file-type audio --json</code></pre> | <pre><code class="language-json">{<br>  "message": {<br>    "msgId": "[MASKED_MESSAGE_ID]"<br>  },<br>  "attachment": [<br>    {<br>      "msgId": "[MASKED_MESSAGE_ID]"<br>    }<br>  ]<br>}</code></pre> | Audio sent as generic file attachment |
| <pre><code class="language-bash">clisbot-dev message send --channel zalo-personal --bot default --target dm:[ZALO_LONG_USER_ID] --message "Voice attachment final pass" --file /tmp/clisbot-zalo-e2e/zalo-personal-audio-test.wav --file-type voice --json</code></pre> | <pre><code class="language-json">{<br>  "message": {<br>    "message": {<br>      "msgId": "[MASKED_MESSAGE_ID]"<br>    },<br>    "attachment": []<br>  },<br>  "voice": {<br>    "msgId": "[MASKED_MESSAGE_ID]"<br>  }<br>}</code></pre> | Voice sent through Zalo voice API |

## Channel-Native Upload

| Command | Output | Note |
| --- | --- | --- |
| <pre><code class="language-bash">clisbot-dev channel-native --channel zalo-personal --bot default messages upload --target dm:[ZALO_LONG_USER_ID] --file /tmp/clisbot-zalo-e2e/zalo-personal-file-test.txt --json</code></pre> | <pre><code class="language-json">[<br>  {<br>    "fileType": "others",<br>    "finished": 1,<br>    "clientFileId": "[MASKED_CLIENT_MESSAGE_ID]",<br>    "chunkId": 1,<br>    "fileId": "[MASKED_FILE_ID]",<br>    "fileUrl": "[MASKED_FILE_URL]",<br>    "totalSize": 69,<br>    "fileName": "zalo-personal-file-test.txt",<br>    "checksum": "[MASKED_CHECKSUM]"<br>  }<br>]</code></pre> | Diagnostic upload returns URL after upload listener callback |

## Message History Checks

| Command | Output | Note |
| --- | --- | --- |
| <pre><code class="language-bash">clisbot-dev message read --channel zalo-personal --bot default --target dm:[ZALO_CLISBOT_USER_ID] --limit 5 --json</code></pre> | <pre><code class="language-text">error zca-js exposes group chat history only; Zalo Personal DM read is not supported by the current API.<br>Help: clisbot-dev --help<br>Docs: docs/user-guide/README.md<br>If you still need help: clone https://github.com/longbkit/clisbot, open it in Codex or Claude Code, and ask for setup help.</code></pre> | DM read unsupported |
| <pre><code class="language-text">Internal zca-js listener probe</code></pre> | <pre><code class="language-json">[<br>  {<br>    "source": "old_messages",<br>    "threadType": 0,<br>    "isSelf": true,<br>    "threadId": "[ZALO_LONG_USER_ID]",<br>    "uidFrom": "[ZALO_CLISBOT_USER_ID]",<br>    "idTo": "[ZALO_LONG_USER_ID]",<br>    "msgId": "[MASKED_MESSAGE_ID]",<br>    "cliMsgId": "[MASKED_CLIENT_MESSAGE_ID]",<br>    "ts": "[MASKED_TIMESTAMP]",<br>    "dName": "Clisbot",<br>    "content": "Hi"<br>  }<br>]</code></pre> | One-off debug command omitted from user-facing log |
