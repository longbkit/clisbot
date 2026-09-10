# Người tạo và người gửi trong session

**CONSIDER — đang cân nhắc, chưa triển khai.** Bằng chứng code kiểm tra ngày 08–09/09/2026.

Use case workspace và phần ưu tiên làm trước nằm ở [feature Theo dõi công việc trong workspace](../features/workspace-organization/README.md).

## Kết quả mong muốn

A tạo workspace/session, B vào chat tiếp: người tạo vẫn là A; tin nhắn của B hiện B; người chat cuối là B. Áp dụng cho Paseo app, channel trực tiếp và Automation. Automation ghi người kích hoạt; nếu không có thì hiện Automation.

## Dữ liệu cần thêm — tên field chưa chốt

| Nơi lưu                      | Thông tin                                                    |
| ---------------------------- | ------------------------------------------------------------ |
| Workspace                    | Người tạo; channel và công việc liên quan theo feature trên. |
| Session                      | Người tạo và người gửi tin nhắn cuối.                        |
| Từng tin nhắn của người dùng | ID người gửi, tên, avatar nếu có.                            |

Daemon lưu dữ liệu này để mở lại vẫn xem được. Danh tính lấy từ đăng nhập hoặc người gửi channel đã được xác minh. Lịch sử cũ không biết tác giả thì để trống. Show/Hide trên app chỉ thay cách hiển thị, không thay quyền truy cập.

## Lịch sử hội thoại hiện được lấy thế nào?

Các cấu hình provider kế thừa dùng lại bộ kết nối có sẵn. Nhóm agent dùng giao thức ACP cũng dùng một bộ kết nối chung; khi tải lại session, nó nhận lịch sử được agent phát lại rồi chuyển về dạng hội thoại chung của Paseo. Bằng chứng: [cách dùng chung bộ kết nối](../../packages/server/src/server/agent/provider-registry.ts#L441), [ACP tải lại session](../../packages/server/src/server/agent/providers/acp-agent.ts#L1544).

Phần còn thiếu là danh tính người gửi của Paseo. Một số lịch sử ACP còn thiếu cả ID tin nhắn, nên chỉ lưu bảng “ID tin nhắn → người gửi” chưa đủ để nối lại chính xác. [Test hiện có minh họa trường hợp thiếu ID](../../packages/server/src/server/agent/providers/acp-agent.test.ts#L3646).

**Phương án đang cân nhắc:** daemon lưu thêm bản hội thoại đã chuẩn hóa kèm người gửi. Code đã có chỗ nối bộ lưu này, tên là [`AgentTimelineStore`](../../packages/server/src/server/agent/agent-timeline-store-types.ts#L47), nhưng [chưa được daemon sử dụng khi khởi động](../../packages/server/src/server/bootstrap.ts#L978) và [chưa nạp lại đầy đủ nội dung](../../packages/server/src/server/agent/agent-manager.ts#L3361). Đây còn là việc cần triển khai và kiểm chứng; thêm avatar ở UI không giải quyết việc giữ thông tin sau restart.

## Tương thích và kiểm chứng

- Thêm thông tin không bắt buộc. Official app dùng daemon khi Managed Access off vẫn tạo/chat bình thường; app Fusion gặp daemon official thì không hiện thông tin chưa được hỗ trợ.
- Thông tin người gửi không mất hoặc gán nhầm sau restart, gửi lại hay tải lại lịch sử. Không đoán tác giả bằng nội dung tin nhắn giống nhau.
- Dữ liệu lưu khi tính năng bật phải được giữ khi tắt; bật lại cần kiểm tra phần lịch sử phát sinh trong thời gian tắt.
- Không thể khôi phục chắc tác giả của lịch sử chưa từng được ghi nhận hoặc bị công cụ bên ngoài thay đổi mà không có ID để đối chiếu.

Phần hiển thị avatar từng tin nhắn cần kiểm chứng việc lưu lịch sử trên. Phần thông tin bổ sung trên workspace, slash command cùng workspace và tự đặt tên có thể làm trước, như feature đã nêu.
