# JSON mẫu — đề xuất, chưa là API đang chạy

Các mẫu dưới đây lấy nguyên từ [examples.json](examples.json), không phải schema rút gọn. Actor/quyền do Host suy ra từ kết nối; client không gửi để tự cấp quyền. Nội dung mẫu là dữ liệu giả.

## 1. App yêu cầu Queue

App tạo ID cho tin và ID cho thao tác. Retry cùng thao tác giữ nguyên các ID và nội dung; requestId chỉ là correlation của RPC.

Schema: [command.schema.json](command.schema.json) · validation example: `enqueue opaque ID`.

```json
{
  "type": "chat.message.enqueue.request",
  "requestId": "request-example",
  "chatId": "cht_example",
  "mutationId": "mutation-example",
  "messageId": "msg-example",
  "content": {
    "text": "@alpha inspect this",
    "images": [],
    "attachments": []
  }
}
```

## 2. Host xác nhận đã lưu

`status: accepted` + receipt chỉ có sau durable commit. `queueSeq` là thứ tự nhận ban đầu; vị trí hiển thị có thể đổi khi reorder. Chưa có bằng chứng Bot đã nhận hoặc trả lời.

Schema: [response.schema.json](response.schema.json) · validation example: `chat.message.enqueue.response accepted`.

```json
{
  "type": "chat.message.enqueue.response",
  "payload": {
    "requestId": "request-example",
    "chatId": "cht_example",
    "mutationId": "mutation-example",
    "result": {
      "status": "accepted",
      "revision": 1,
      "receipt": {
        "messageId": "msg-example",
        "queueSeq": 1,
        "acceptedAt": "2026-10-14T10:00:00.000Z",
        "acceptedRevision": 1
      },
      "duplicate": false
    }
  }
}
```

## 3. Chưa rõ provider đã nhận Steer

Sau lỗi này không tự phát lại hoặc chuyển thành interrupt. Giữ nội dung, chỉ rõ chưa biết kết quả và dẫn người dùng kiểm session.

Schema: [response.schema.json](response.schema.json) · validation example: `steer unknown`.

```json
{
  "type": "chat.message.steer.response",
  "payload": {
    "requestId": "request-example",
    "chatId": "cht_example",
    "mutationId": "mutation-example",
    "result": {
      "status": "unknown",
      "messageId": "msg-example",
      "error": {
        "code": "outcome_unknown",
        "message": "Do not retry provider side effects automatically"
      }
    }
  }
}
```

## Schema nào dùng để review gì?

| File                             | Mục đích                                                           |
| -------------------------------- | ------------------------------------------------------------------ |
| [command](command.schema.json)   | Enqueue, edit, cancel, reorder, steer và fetch                     |
| [response](response.schema.json) | Accepted/rejected/applied/unknown và snapshot fetch                |
| [event](event.schema.json)       | Snapshot thay đổi, gửi sau commit                                  |
| [content](content.schema.json)   | Text, images và attachments                                        |
| [intent](intent.schema.json)     | Client giữ ID + payload reference khi pending/unknown              |
| [record](record.schema.json)     | State Host phục hồi từ journal, không ghi full record mỗi thao tác |
| [journal](journal.schema.json)   | Một transaction delta cho mỗi durable frame                        |

Bảy schema standalone JSON Schema draft 2020-12; [contracts.mts](contracts.mts) là authoring source, JSON sinh từ [generate.mts](generate.mts). Kiểm lại bằng `node docs/features/bots-and-chats/queue-proposal/validate.mjs` từ repo root. [Phụ lục](engineering.md#invariants-ngoài-json-schema) ghi những ràng buộc schema không chứng minh: quyền, fsync, ID uniqueness, CAS và provider outcome.

[Quay lại đề xuất để chốt](README.md).
