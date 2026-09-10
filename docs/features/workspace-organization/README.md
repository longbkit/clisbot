# Theo dõi công việc trong workspace

**CONSIDER — đang cân nhắc, chưa triển khai.** Cập nhật 09/09/2026.

Một workspace có thể chứa nhiều session. Mục tiêu là dễ tìm lại công việc, kể cả khi đổi người, đổi agent hoặc mở session mới.

## Các use case

| Nhu cầu                                             | Kết quả mong muốn                                                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Một ticket/PR qua nhiều lần xử lý                   | Các session cùng công việc nằm trong một workspace.                                                                                                 |
| Một project có bot ở nhiều Slack channel            | Theo dõi riêng từng channel và các thread. Còn cần xác nhận: một workspace/channel với session riêng từng thread, hay một session chung cả channel. |
| Một user trong một project theo ngày/tuần           | Trong cùng kỳ dùng một workspace; sang kỳ mới tạo workspace mới. Cần chốt múi giờ và cách xử lý session đang chạy.                                  |
| Tin nhắn bắt đầu bằng Jira/task ID, ví dụ `ABC-123` | Nhận diện công việc và đưa các lần xử lý về workspace của task đó đến khi hoàn thành.                                                               |

## Làm trước — chưa cần đổi YAML

| Việc                                        | Có sẵn                                                            | Cần bổ sung                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Hiển thị, lọc, sắp xếp, gom nhóm            | Workspace đã có nhãn và ngày tạo                                  | Thông tin người tạo, channel, ticket/task liên quan; cách xem tương ứng trên app. Tên field chưa chốt.                         |
| `/side`, `/fork` tạo session cùng workspace | Hai lệnh đã tạo session mới; daemon đã cho chọn workspace bằng ID | Truyền workspace của session nguồn khi chạy lệnh. `/side` hiện tự archive session phụ; phải giữ workspace và các session khác. |
| Tự đặt tên từ yêu cầu đầu tiên              | Paseo app đã có chức năng này                                     | Dùng lại cho luồng channel; giữ tên người dùng đã đặt. Chưa cần rule đặt tên riêng.                                            |

Ba việc này cần sửa code và cách lưu dữ liệu, **không cần thêm rule trong YAML channel/workflow**. Thông tin mới không bắt buộc, app/daemon official vẫn phải kết nối và dùng chức năng cũ bình thường. Tính năng mới có tùy chọn bật/tắt.

## Hai tên code đã nhắc nghĩa là gì?

Cả hai **đã có sẵn**, không phải thành phần mới được đề xuất:

- [`firstAgentContext`](../../../packages/protocol/src/messages.ts#L2418): dữ liệu gồm yêu cầu ban đầu và nội dung đính kèm, được gửi khi tạo workspace.
- [`WorkspaceAutoName`](../../../packages/server/src/server/workspace-auto-name.ts#L42): phần code trên daemon dùng dữ liệu đó để tự sinh tên workspace. [Luồng tạo workspace của app đã gọi nó](../../../packages/server/src/server/session.ts#L6285).

Channel hiện tạo session rồi mới gửi yêu cầu đầu tiên. Cần nối yêu cầu đó vào chức năng đặt tên có sẵn. Thêm session vào workspace cũ không được đổi tên workspace.

## Để bước sau

Tự tìm/tạo workspace theo ticket, channel hoặc user + ngày/tuần; nhận diện prefix task ID; rule tên tùy chỉnh. Các cấu hình từng đề xuất chưa được chốt và chưa có trong code.

Gom nhóm trên màn hình chỉ đổi cách xem. Muốn các session thực sự dùng chung workspace thì cần thêm bước tìm/chọn workspace. Lợi ích nên đo bằng thời gian tìm lại công việc và số lần tránh tạo workspace thừa.

Bằng chứng còn lại: [nhãn workspace](../../../packages/server/src/server/workspace-registry.ts#L95), [tạo session từ slash command](../../../packages/hub/src/channels/commands-lifecycle.ts#L180), [daemon nhận workspace ID](../../../packages/protocol/src/messages.ts#L1653). Phần người tạo/người gửi xem [thiết kế riêng](../../audits/2026-09-08-workspace-placement-and-session-authorship.md).
