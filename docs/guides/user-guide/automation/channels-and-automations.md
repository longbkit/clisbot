# Channels và Automations

[User guide](../README.md) · [Cấp Access](../access/members-and-teams.md) · [Q&A](../help/faq.md)

|                  | Channel                                                | Automation                                                |
| ---------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| Mục đích         | Nhận/gửi hội thoại qua Slack, Telegram…                | Thực hiện một công việc hoặc Workflow nhiều bước          |
| Cấu hình chính   | Connection, conversation, route và nơi trả lời         | Các bước, Host/Project, cấu hình Agent, inputs và kết quả |
| Cách dùng        | Gửi tin nhắn vào conversation được cấu hình            | Chạy trực tiếp, nhận event hoặc nhận tin nhắn qua Channel |
| Quyền người dùng | `channel.use` và phạm vi conversation/audience phù hợp | `automation.run` khi chạy trực tiếp                       |

Channel có thể chuyển vào một Automation hoặc **Start or continue an Agent** trực tiếp. Vì vậy không phải mọi tin nhắn Channel đều tạo Workflow run. Trong Automation, chọn tiếp tục cùng Agent vẫn tạo một Automation run mới cho mỗi yêu cầu.

## Cấu hình một Automation nhận việc qua chat

Owner/Admin thực hiện:

1. Mở **Channels**, tạo/cấu hình Connection của nhà cung cấp; nhập credential theo form và lưu. Kiểm tra Connection hoạt động.
2. Mở **Automations**, tạo công việc/Workflow, chọn Host, Project và cấu hình Agent.
3. Thêm/sửa các bước. Trong phần **Result**, cấu hình nội dung/kênh trả lời cần dùng.
4. Chọn **Add input → Channel conversation**, chọn Connection và conversation nguồn. Kiểm tra route, điều kiện nhận tin và nơi trả lời.
5. Chọn audience được dùng; mặc định riêng tư **Only you**, mở rộng khi đã sẵn sàng. Lưu Workflow và input.
6. Trong **Access**, cấp quyền Channel cho Team/Member với đúng conversation; người dùng liên kết danh tính Slack/Telegram của mình trong **Account** nếu cần.
7. Gửi một tin nhắn thật từ người được cấp quyền, kiểm tra run và phản hồi trong conversation.

Connection và Workflow là các cấu hình lưu riêng. Nếu Workflow đã lưu nhưng input thất bại, sửa và lưu lại input trong cùng luồng; kiểm tra bản ghi hiện có trước khi tạo lại để tránh trùng. Không dựa vào draft chưa lưu sau khi reload.

## Điều khiển bằng slash command

Gõ `/help` để xem các lệnh dùng chung. [Hướng dẫn slash command](../../../features/slash-commands/user-guide.md)
giải thích cách dùng; [bảng quyền và phạm vi](../../../features/slash-commands/README.md)
là tài liệu tham chiếu đầy đủ.

- Route trực tiếp: `/new <nội dung>`, `/resume <id>`, `/stop`, `/steer`, `/queue`
  điều khiển phiên Agent; `/agent`, `/provider`, `/model`, `/effort`, `/permission`
  chỉnh cấu hình trong phạm vi được cấp.
- `/fork [nội dung]` tiếp tục trong phiên mới có lịch sử; `/side <nội dung>` và
  `/quick <nội dung>` trả lời riêng một lần mà không thay binding hiện tại.
- Route Automation: `/status`, `/cowork`, `/stop`, `/me`, `/help` dùng được;
  các lệnh chỉnh phiên/cấu hình trực tiếp trả lời rõ là không áp dụng.
- `/cowork`, `/status`, `/me` và kết quả cấu hình gửi DM cho người gọi khi lệnh
  xuất phát từ conversation công khai. Không gửi được DM thì không đăng thông
  tin đó trở lại conversation.

Trong **Access**, có thể cấp quyền cho **Guest** để người chưa liên kết Hub
Member dùng Channel. Guest mặc định không có quyền; Member đã liên kết dùng
quyền của Member/Team và không tự nhận quyền Guest. Thay đổi provider được lưu
chờ áp dụng bằng `/new` hoặc `/fork`; tin nhắn thường vẫn đi vào phiên hiện tại.

## Chỉ dùng app hoặc chỉ dùng Channel

- Muốn mở Project/terminal trong app: cấp **Connect + Project access**.
- Muốn chạy trực tiếp một Automation: cấp quyền **Run** cho Automation đó.
- Muốn gọi luồng cố định qua Channel: cấp **Channel access**, liên kết danh tính và cho vào audience phù hợp. Không cần cấp Connect/Project/Automation Run chỉ để gọi route đã cấu hình.

Quyền chạy công việc cố định không cho người gọi tự chọn mọi Project, model hoặc mở terminal. Cấu hình thực thi và quyền dịch vụ được kiểm tra riêng khi thiết lập. Với công việc do Hub thực thi, kiểm tra daemon đã enroll và quan hệ Hub có quyền `hub.execute` cần thiết.

**Send test message** chỉ chứng minh gửi tin ra được. Để kiểm tra toàn bộ luồng phải gửi tin vào thật, xem hoạt động/run và kết quả trả về. Nếu không nhận phản hồi, xem [Q&A](../help/faq.md).
