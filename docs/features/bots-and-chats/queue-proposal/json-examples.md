# Shape queue tối giản trên Host

**Implementation candidate 2026-10-18; chưa merge/deploy.** Một `queue.json` tại [thư mục target](README.md#host-lưu-ở-file-nào). Schema production: `input-queue/input-queue-store.ts` và `input-queue/content.ts`; RPC: `protocol/src/input-queue.ts`. Ví dụ dùng ID và metadata giả.

## Snapshot có file và ảnh

```json
{
  "version": 1,
  "revision": 7,
  "items": [
    {
      "id": "msg_01",
      "createdAt": "2026-10-18T01:20:00.000Z",
      "senderId": "user:user_example",
      "state": "queued",
      "payload": {
        "text": "Xem ảnh lỗi và log rồi sửa giúp tôi.",
        "attachments": [
          {
            "type": "uploaded_file",
            "id": "upload_example",
            "fileName": "app.log",
            "mimeType": "text/plain",
            "size": 12,
            "path": "/fixture/target/uploads/upload_example/app.log"
          }
        ],
        "files": [
          {
            "id": "upload_example",
            "fileName": "app.log",
            "mimeType": "text/plain",
            "size": 12,
            "relativePath": "uploads/upload_example/app.log"
          },
          {
            "id": "image_example",
            "fileName": "image.png",
            "mimeType": "image/png",
            "size": 24,
            "relativePath": "uploads/image_example/image.png"
          }
        ],
        "images": [
          {
            "id": "image_example",
            "fileName": "image.png",
            "mimeType": "image/png",
            "size": 24,
            "relativePath": "uploads/image_example/image.png"
          }
        ],
        "fingerprint": "fixture_content_digest",
        "identity": { "actor": { "kind": "user", "id": "user_example" } }
      }
    }
  ]
}
```

- `version` và `revision` thuộc snapshot; thứ tự `items` là FIFO. File rỗng vẫn giữ revision.
- `id` là logical message/submission ID, không cấp ID mới khi retry cùng input. `senderId` và `identity` do Host lấy từ operation đã xác thực; client không tự khai actor.
- `state`: `queued`, `sending`, `needs_review`; `reason` optional trên item giải thích lỗi/unknown. Không có `editing`, draft, edit token, lease hay receipt history.
- `payload` chứa text + wire attachment/context metadata inline. Attachment-only hợp lệ. `fingerprint` chỉ phục vụ retry của item còn pending, bị bỏ cùng item sau handoff.
- `files` là references trong upload storage hiện có; `images` là subset cho adapter khôi phục image payload. Không có base64 trong snapshot. `relativePath` do Host tạo và kiểm theo đúng target; Windows dùng path separator của Host. `uploaded_file.path` là wire shape đã có, không mở quyền đọc path client tùy ý.
- Text/review/issue/forge context giữ object và source metadata hiện có; mention rules dùng text khi Chat owner nhận handoff. Không giữ tiến độ Bot/round trong queue.
- Bytes được kiểm và ghi bền vững trước snapshot ack. TTL draft giữ file còn được queue hoặc canonical message links tham chiếu. Handoff chuyển retention sang message trước khi queue bỏ item.

## Mutation trên wire

`agent.queue.execute.request` mang `agentId`; `chat.queue.execute.request` mang `chatId`. Cả hai có `requestId` và cùng `command`. Gate duy nhất là `server_info.features.hostInputQueue`.

```json
{
  "action": "update",
  "id": "msg_01",
  "revision": 7,
  "text": "Nội dung đã sửa",
  "attachments": [],
  "images": []
}
```

Các action: `fetch`, `read_file`, `enqueue`, `update`, `move_to_end`, `delete`, `steer_now`, `send_now`, `discard`. `enqueue` có ID ổn định. Mutation item có ID và expected revision; chỉ update/move/delete item còn queued. `discard` là disposition tường minh cho `needs_review`; không Stop model. `send_now` claim rồi Interrupt theo owner hiện có, không lấy item ra ở client trước gửi.

Response mang `queue: {revision, items}`, `error` và optional `errorCode: "queue_conflict"`. Fetch có thể gửi revision hiện tại; `unchanged: true` tránh đọc/gửi lại bytes ảnh. Wire view có thể hydrate ảnh; đây không phải format persistence.

## Local edit và handoff

Mở/hủy editor không ghi Host. Save cập nhật cùng ID tại chỗ; Move to end cập nhật và chuyển cùng ID trong một commit. Item đã started/deleted không được tạo lại. Draft giữ ở app, chỉ **Thêm thành mục mới** mới cấp ID khác ở cuối. RAM metadata theo composer editing-session owner sống qua layout remount, mất khi app process đóng.

Sau durable handoff, snapshot không giữ item hay receipt:

```json
{ "version": 1, "revision": 12, "items": [] }
```

Restart đối chiếu `sending` với submission/transcript owner: có proof thì bỏ, chưa rõ thành `needs_review` và chặn FIFO. Không replay chỉ vì timeout. Không tuyên bố exactly-once hoặc chống mất điện.

## Contract và fixture

`contracts.mts` import schema production. `generate.mts` tạo bốn schema record/content/command/response; `validate.mjs` kiểm các ví dụ tối giản trong `examples.json`. Journal/intent/event schemas cũ đã bị thay trong candidate; Git giữ lịch sử. Không dùng 61 fixtures journal cũ làm bằng chứng cho thiết kế này.

`steer_now`: `{ "action": "steer_now", "id": "msg_01", "revision": 7, "target": { "agentId": "agent_01", "turnId": "turn_01" } }`. Chỉ strict Steer đúng target, không thay lượt; giữ item nếu chưa xác nhận durable handoff. `send_now` chỉ là Interrupt and send tường minh. `read_file` có id/fileId/offset, response tối đa 64 KiB base64 cùng done; không đổi revision hoặc persist editor state.

Compatibility correction 2026-10-18: session + DM + group retain separate client owners on old/disabled Hosts. DM drains through ChatSend, with stable per-item messageId; accepted local rows never migrate on upgrade. Owner accepts partial automatic support only for genuinely old group wire without discussion authority: retain/edit/delete files locally and explicitly Send the item via Chat rules; never infer idle from a speaker gap or silently send Queue. Capable feature-off groups auto-drain on authoritative discussion idle. App-memory queue is lost when the app closes. See engineering.md and the numbered 36280 audit.
