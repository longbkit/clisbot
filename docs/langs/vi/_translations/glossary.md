[English](../../../../README.md) | [Tiếng Việt](./glossary.md) | [简体中文](../../zh-CN/_translations/glossary.md) | [한국어](../../ko/_translations/glossary.md)

# Thuật ngữ chuẩn tiếng Việt

## Mục tiêu

Tài liệu này là bảng từ chuẩn cho các bản dịch tiếng Việt của `clisbot`, bao gồm cả root README tiếng Việt và các trang đã mirror dưới `docs/langs/vi/`.

## Phạm vi quản lý

- File này sở hữu cách dùng các thuật ngữ lặp lại trong toàn bộ doc tiếng Việt.
- Nếu đổi một thuật ngữ ở đây, hãy đồng bộ lại `docs/langs/root/README.vi.md` và các trang tiếng Việt đã mirror theo tree hiện có.

## Bảng thuật ngữ ưu tiên

| English | Ưu tiên dùng trong tiếng Việt | Ghi chú |
| --- | --- | --- |
| you | bạn | Trong doc tiếng Việt ưu tiên xưng hô trung tính bằng “bạn”, không dùng “bạn” để dịch `you`. |
| agent | agent | Giữ nguyên vì phổ biến với người dùng kỹ thuật. |
| agentic | agentic AI mạnh mẽ | Dùng khi muốn nhấn mạnh năng lực tự chủ và hành động. |
| bot | bot | Giữ nguyên. |
| workspace | workspace / không gian làm việc | Trong prose có thể dùng “không gian làm việc”; trong context kỹ thuật ưu tiên `workspace`. |
| queue | hàng đợi / `queue` | Khi nói về lệnh và nhóm tính năng thì giữ `queue`. |
| loop | lặp / `loop` | Tùy ngữ cảnh; lệnh thì giữ `/loop`. |
| route | route | Dùng `route` khi nói về CLI/config để tránh lệch nghĩa. |
| routing | ngữ cảnh chat / routing | Trong prose ưu tiên “ngữ cảnh chat” khi nói về nơi bot đang xử lý hội thoại. |
| surface | ngữ cảnh chat | Không dùng “bề mặt” trong doc sản phẩm tiếng Việt. |
| pairing | ghép quyền ban đầu / pairing | Có thể giữ `pairing` khi nói về command. |
| follow-up | mạch trả lời tiếp theo | Tránh dịch quá cứng. |
| streaming | streaming / phát tiến trình trực tiếp | Trong product prose vẫn có thể giữ `streaming`. |
| trải nghiệm tối ưu ở kênh chat | trải nghiệm tối ưu ở kênh chat | Ưu tiên diễn đạt theo trải nghiệm thay vì bê nguyên thuật ngữ. |
| response mode | response mode | Khi nói về config hoặc command nên giữ nguyên. |
| additional message mode | additional-message-mode | Khi nói về config hoặc command nên giữ nguyên. |
| allowlist | allowlist / danh sách cho phép | Trong CLI hoặc config nên giữ `allowlist`. |
| render | render | Trong contract của `message` command nên giữ nguyên. |
| runtime | runtime / tiến trình chạy thực tế | |
| session | session / phiên | |
| sessionId | `sessionId` | Không dịch. |
| topic | topic | Telegram context nên giữ `topic`. |
| thread | thread | Slack context nên giữ `thread`. |
| assistant | trợ lý / assistant | Trong prose có thể dùng “trợ lý”; giữ `assistant` khi sát positioning của sản phẩm. |
| AI-native | AI-native | Giữ nguyên vì đây là product direction term đang được dùng nhất quán trong repo. |
| release notes | release notes | Thuật ngữ quá phổ biến, không cần ép dịch cứng. |
| update guide | hướng dẫn update | |
| migration | migration / chuyển đổi phiên bản | |
| owner | owner | Với role nên giữ nguyên. |
| admin | admin | Với role nên giữ nguyên. |
| prompt | prompt | Không nên dịch thành “lời nhắc” trong product docs kỹ thuật. |
| control plane | control plane | Có thể giải thích thêm khi cần, nhưng không đổi term chính. |
| capability | capability / năng lực hỗ trợ | Trong bảng đánh giá hoặc contract nên có thể giữ `capability`. |
| compatibility | compatibility / tương thích | `CLI compatibility` nên giữ cả hai lớp nghĩa này. |
| readiness | readiness / trạng thái sẵn sàng | Khi nói về machine-readable state, có thể giữ `readiness`. |
| drift | drift / lệch hành vi | Dùng cho chênh lệch do upstream thay đổi theo thời gian. |
| artifact | artifact | Giữ nguyên khi nói về file output phục vụ validation. |
| fallback | fallback | Giữ nguyên trong ngữ cảnh contract hoặc degraded path. |
| native command | lệnh gốc / native command | Trong prose ưu tiên “lệnh gốc”; khi bám tên feature có thể giữ `native command`. |
| machine-readable | đọc được bằng máy | Ưu tiên cách nói này thay cho giữ nguyên tiếng Bạn trong prose. |
| human-readable | dễ đọc với con người | Dùng khi nói về output, artifact, hay proof path. |
| risk slice | risk slice / lát rủi ro | Giữ `risk slice` trong tên khái niệm, có thể giải thích thêm bằng “lát rủi ro”. |
| best-effort | best-effort | Giữ nguyên vì phổ biến trong docs kỹ thuật. |
| chat-native | chat-native / tối ưu cho kênh chat | Giữ `chat-native` khi nói về product direction; prose có thể diễn giải là “vận hành ngay trong chat”. |
| OpenClaw / Hermes Agent | OpenClaw / Hermes Agent | Giữ nguyên tên sản phẩm/dự án tham chiếu. |
| Zalo Bot | Zalo Bot | Giữ nguyên tên channel. |
| Zalo Personal | Zalo Personal | Giữ nguyên; không gắn nhãn alpha trong positioning chính. |
| auto-skill | auto-skill / tự tạo và cải thiện skill | Dùng khi nói về hướng Hermes-style skill evolution. |

## Quy tắc dùng từ

- Ưu tiên cách nói tự nhiên với người dùng kỹ thuật Việt Nam.
- Chỉ giữ tiếng Bạn khi đó thật sự là cách gọi phổ biến hoặc là public term của CLI/config.
- Nếu cần đổi thuật ngữ, sửa file này trước rồi mới lan sang root README tiếng Việt và các trang tiếng Việt khác.
