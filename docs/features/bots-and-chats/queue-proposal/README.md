# Queue / Steer: đề xuất để Long chốt

**Đề xuất, chưa triển khai.** Gửi thêm tin khi Bot đang làm: Host giữ tin, đóng app không mất; không tự ngắt việc hoặc phát lại khi chưa rõ kết quả. Mặc định tốt, không cần nhớ flag.

## Người dùng sẽ làm gì?

| Thao tác                   | Hiện tại ở baseline `2aeb8b5c4`                                                                              | Target đề xuất                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Send khi rảnh**          | Gửi vào session hoặc Chat trên Host.                                                                         | Gửi như hiện tại, dùng chung đường nhận input.                                                                        |
| **Send khi đang chạy**     | Session mặc định Steer, queue ở RAM client. DM/group: chọn Queue vẫn có thể gửi ngay và thay lượt đang chạy. | Mặc định **Queue**: Host lưu tin, hiện vị trí và chờ lượt hiện tại kết thúc.                                          |
| **Steer**                  | Tùy provider; đường hiện tại có thể interrupt/replace nếu không steer được.                                  | Chọn **Steer** để chỉ dẫn ngay cho đúng Bot/lượt. Không hỗ trợ thì báo và giữ nội dung; không tự ngắt lượt.           |
| **Sửa / hủy / đổi thứ tự** | Session có Edit/Send now trên queue RAM; Bot Chat chưa có queue tương ứng.                                   | Bấm tin chờ → Sửa, Hủy hoặc đổi thứ tự. Nếu Host đã lấy xử lý thì báo không sửa/hủy được; không giả rằng đã dừng Bot. |

Ví dụ: đang sửa lỗi → “Sau đó thêm test” → **Send** → “Queued #1”, đóng app vẫn còn. Muốn tác động ngay: **Steer** → “Giữ nguyên public API”. Đã nhận chỉ dẫn chưa có nghĩa đã làm xong.

## DM, group và session có gì khác?

- **Bot DM:** chờ hết lượt; đang đợi quyền/câu trả lời thì hiện lý do, không tự cấp quyền hoặc trả lời thay.
- **Bot group:** Queue chờ **hết discussion**, không chen giữa các Bot; discussion 8 rounds có thể phải chờ hết. Giữ mention rules hiện có. Steer chỉ **một Bot đang nói**; nhiều Bot dùng Queue.
- **Session thường:** phase sau mới chuyển lên Host. Phase đầu giữ behavior hiện tại, ghi rõ “Queued on this device” hoặc “Queued on Host”; không hứa session đã đồng bộ.

## Đóng app, mất mạng, đổi máy: tin còn không?

| Tình huống                      | Target và điều người dùng nhìn thấy                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Chưa Send hoặc đang offline     | Draft ở thiết bị; **chưa gửi**. Không tự gửi khi online lại.                                                                               |
| Đã bấm Send, chưa nhận xác nhận | “Đang xác nhận”; client giữ nội dung + ID để đối soát. Timeout có thể là “Chưa rõ kết quả”, không tự gọi là queued.                        |
| Host đã xác nhận **Queued**     | Host đã ghi bền vững. Đóng/reload app không làm mất; thiết bị khác cùng tài khoản và quyền thấy cùng queue.                                |
| Host restart                    | Khôi phục tin chưa giao. Tin có thể đã tới provider nhưng thiếu bằng chứng giữ “Chưa rõ kết quả”; yêu cầu kiểm session, không tự phát lại. |
| Queue đầy hoặc không lưu được   | Báo từ chối, giữ nội dung để người dùng xử lý. Không bỏ tin đã accepted để lấy chỗ.                                                        |

**Client:** draft và bản chờ xác nhận. **Host chứa Chat:** queue đã nhận, thứ tự và tiến độ group. **Provider:** thực thi input đã giao. **Hub:** truy cập/transport, không giữ queue. Draft không đồng bộ giữa máy; không hứa provider luôn thực thi đúng một lần.

## Cần Long chốt những gì?

| Quyết định                | Khuyến nghị cụ thể                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Send khi busy**      | Mặc định **Queue**, Steer chọn riêng. Đây là khuyến nghị UX **mới**, cần Long chốt.                                                                                          |
| **2. Phạm vi triển khai** | **DM/group trước**, session ở phase sau. Không đổi lựa chọn session đang dùng trong phase 1. Lựa chọn khác: làm cả session cùng phase, phạm vi implementation và QA lớn hơn. |
| **3. Group Steer**        | Chỉ **một Bot/active turn**, đúng mention rules. Chưa làm multi-Bot Steer hoặc “Send now” ngắt discussion.                                                                   |

Queue có giới hạn: đầy thì từ chối và giữ nội dung, không âm thầm bỏ tin đã nhận. [Dung lượng và retention](engineering.md#state-failure-và-recovery-chưa-implemented) là engineering defaults đề xuất, chưa là implementation. Host cũ báo chưa hỗ trợ, giữ draft; không giả Queue qua send cũ. Không tự nhập queue RAM. Còn tin chờ/chưa rõ kết quả phải drain/export trước downgrade.

Khuyến nghị duyệt **1–3**, rồi triển khai với các bảo đảm trên. Bản sửa tin nhảy vị trí không triển khai queue này. Không có CLI command mới; tên `chat.message.*` là wire dự kiến.

Chi tiết để kiểm khi cần: [JSON mẫu đọc nhanh](json-examples.md) · [7 JSON Schema + 61 validation examples](engineering.md#commands-receipt-và-event-chính-xác) · [persistence, quyền, retry và recovery](engineering.md). Schema chỉ kiểm cấu trúc; chưa chứng minh fsync, concurrency hoặc runtime.
