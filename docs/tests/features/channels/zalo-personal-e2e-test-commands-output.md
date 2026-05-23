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
| `[MASKED_LINK_THUMB_URL]` | Link preview thumbnail URL |

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
| <pre><code class="language-bash">clisbot-dev message send --channel zalo-personal --bot default --target dm:[ZALO_LONG_USER_ID] --message "Image URL attachment final pass" --file http://127.0.0.1:6430/zalo-personal-image-test.png --file-type image --json</code></pre> | <pre><code class="language-json">{<br>  "message": null,<br>  "attachment": [<br>    {<br>      "msgId": "[MASKED_MESSAGE_ID]"<br>    }<br>  ]<br>}</code></pre> | URL downloaded by clisbot, then uploaded to Zalo |
| <pre><code class="language-bash">clisbot-dev message send --channel zalo-personal --bot default --target dm:[ZALO_LONG_USER_ID] --message "File URL attachment final pass" --file http://127.0.0.1:6430/zalo-personal-file-test.txt --file-type file --json</code></pre> | <pre><code class="language-json">{<br>  "message": {<br>    "msgId": "[MASKED_MESSAGE_ID]"<br>  },<br>  "attachment": [<br>    {<br>      "msgId": "[MASKED_MESSAGE_ID]"<br>    }<br>  ]<br>}</code></pre> | URL downloaded by clisbot, then uploaded to Zalo |
| <pre><code class="language-bash">clisbot-dev message send --channel zalo-personal --bot default --target dm:[ZALO_LONG_USER_ID] --message "Video attachment local final pass" --file /tmp/clisbot-zalo-e2e/zalo-personal-video-test.mp4 --file-type video --json</code></pre> | <pre><code class="language-json">{<br>  "message": {<br>    "msgId": "[MASKED_MESSAGE_ID]"<br>  },<br>  "attachment": [<br>    {<br>      "msgId": "[MASKED_MESSAGE_ID]"<br>    }<br>  ]<br>}</code></pre> | Local video uploaded through shared attachment path |
| <pre><code class="language-bash">clisbot-dev message send --channel zalo-personal --bot default --target dm:[ZALO_LONG_USER_ID] --message "Video URL attachment final pass" --file http://127.0.0.1:6430/zalo-personal-video-test.mp4 --file-type video --json</code></pre> | <pre><code class="language-json">{<br>  "message": {<br>    "msgId": "[MASKED_MESSAGE_ID]"<br>  },<br>  "attachment": [<br>    {<br>      "msgId": "[MASKED_MESSAGE_ID]"<br>    }<br>  ]<br>}</code></pre> | URL video downloaded by clisbot, then uploaded through shared attachment path |
| <pre><code class="language-bash">clisbot-dev message send --channel zalo-personal --bot default --target dm:[ZALO_LONG_USER_ID] --message "Multiple file negative test" --file /tmp/clisbot-zalo-e2e/zalo-personal-file-test.txt --file /tmp/clisbot-zalo-e2e/zalo-personal-image-test.png --json</code></pre> | <pre><code class="language-text">error --file accepts one value; multiple attachments are not supported yet<br>Help: clisbot-dev --help<br>Docs: docs/user-guide/README.md<br>If you still need help: clone https://github.com/longbkit/clisbot, open it in Codex or Claude Code, and ask for setup help.</code></pre> | Negative test; repeated `--file` is rejected instead of silently using one |

## Channel-Native Upload

| Command | Output | Note |
| --- | --- | --- |
| <pre><code class="language-bash">clisbot-dev channel-native --channel zalo-personal --bot default messages upload --target dm:[ZALO_LONG_USER_ID] --file /tmp/clisbot-zalo-e2e/zalo-personal-file-test.txt --json</code></pre> | <pre><code class="language-json">[<br>  {<br>    "fileType": "others",<br>    "finished": 1,<br>    "clientFileId": "[MASKED_CLIENT_MESSAGE_ID]",<br>    "chunkId": 1,<br>    "fileId": "[MASKED_FILE_ID]",<br>    "fileUrl": "[MASKED_FILE_URL]",<br>    "totalSize": 69,<br>    "fileName": "zalo-personal-file-test.txt",<br>    "checksum": "[MASKED_CHECKSUM]"<br>  }<br>]</code></pre> | Diagnostic upload returns URL after upload listener callback |
| <pre><code class="language-bash">clisbot-dev channel-native --channel zalo-personal --bot default messages upload --target dm:[ZALO_LONG_USER_ID] --file http://127.0.0.1:6430/zalo-personal-file-test.txt --json</code></pre> | <pre><code class="language-json">[<br>  {<br>    "fileType": "others",<br>    "finished": 1,<br>    "clientFileId": "[MASKED_CLIENT_MESSAGE_ID]",<br>    "chunkId": 1,<br>    "fileId": "[MASKED_FILE_ID]",<br>    "fileUrl": "[MASKED_FILE_URL]",<br>    "totalSize": 69,<br>    "fileName": "zalo-personal-file-test.txt",<br>    "checksum": "[MASKED_CHECKSUM]"<br>  }<br>]</code></pre> | Diagnostic URL upload downloads first, then uploads to Zalo |

## Channel-Native Send

| Command | Output | Note |
| --- | --- | --- |
| <pre><code class="language-bash">set -a; source .env; set +a; clisbot-dev channel-native --channel zalo-personal --bot default messages send --target dm:[ZALO_LONG_USER_ID] --message "Native style command test" --style bold:0:6 --style green:7:5 --urgency important --json</code></pre> | <pre><code class="language-json">{<br>  "message": {<br>    "msgId": "[MASKED_MESSAGE_ID]"<br>  },<br>  "attachment": []<br>}</code></pre> | Direct native styled text send |
| <pre><code class="language-bash">clisbot-dev channel-native --channel zalo-personal --bot default messages parse-link https://example.com --json</code></pre> | <pre><code class="language-json">{<br>  "data": {<br>    "thumb": "[MASKED_LINK_THUMB_URL]",<br>    "title": "Example Domain",<br>    "desc": "https://example.com",<br>    "src": "example.com",<br>    "href": "https://example.com",<br>    "media": {<br>      "type": 0,<br>      "count": 0,<br>      "mediaTitle": "",<br>      "artist": "",<br>      "streamUrl": "",<br>      "stream_icon": ""<br>    },<br>    "stream_icon": ""<br>  },<br>  "error_maps": {<br>    "1": 0,<br>    "2": 0<br>  }<br>}</code></pre> | Parses link preview metadata |
| <pre><code class="language-bash">set -a; source .env; set +a; clisbot-dev channel-native --channel zalo-personal --bot default messages link send --target dm:[ZALO_LONG_USER_ID] https://example.com --message "Native link send test" --json</code></pre> | <pre><code class="language-json">{<br>  "msgId": "[MASKED_MESSAGE_ID]"<br>}</code></pre> | Sends native link preview |
| <pre><code class="language-bash">set -a; source .env; set +a; clisbot-dev channel-native --channel zalo-personal --bot default messages video send --target dm:[ZALO_LONG_USER_ID] --message "Video direct send with uploaded thumbnail" --file /tmp/clisbot-zalo-e2e/zalo-personal-video-test.mp4 --thumbnail /tmp/clisbot-zalo-e2e/zalo-personal-image-test.png --duration-ms 1000 --width 640 --height 360 --json</code></pre> | <pre><code class="language-json">{<br>  "msgId": "[MASKED_MESSAGE_ID]"<br>}</code></pre> | Direct `sendVideo` path uploads video and thumbnail, then sends video URL with thumbnail URL |

## Message History Checks

| Command | Output | Note |
| --- | --- | --- |
| <pre><code class="language-bash">clisbot-dev message read --channel zalo-personal --bot default --target dm:[ZALO_CLISBOT_USER_ID] --limit 5 --json</code></pre> | <pre><code class="language-text">error zca-js exposes group chat history only; Zalo Personal DM read is not supported by the current API.<br>Help: clisbot-dev --help<br>Docs: docs/user-guide/README.md<br>If you still need help: clone https://github.com/longbkit/clisbot, open it in Codex or Claude Code, and ask for setup help.</code></pre> | DM read unsupported |
| <pre><code class="language-text">Internal zca-js listener probe</code></pre> | <pre><code class="language-json">[<br>  {<br>    "source": "old_messages",<br>    "threadType": 0,<br>    "isSelf": true,<br>    "threadId": "[ZALO_LONG_USER_ID]",<br>    "uidFrom": "[ZALO_CLISBOT_USER_ID]",<br>    "idTo": "[ZALO_LONG_USER_ID]",<br>    "msgId": "[MASKED_MESSAGE_ID]",<br>    "cliMsgId": "[MASKED_CLIENT_MESSAGE_ID]",<br>    "ts": "[MASKED_TIMESTAMP]",<br>    "dName": "Clisbot",<br>    "content": "Hi"<br>  }<br>]</code></pre> | One-off debug command omitted from user-facing log |
