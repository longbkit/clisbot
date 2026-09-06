# Managed Access: off hay external?

[User guide](../README.md) · [Các mức quyền](../access/permissions.md) · [Q&A](../help/faq.md)

Managed Access là cấu hình **từng daemon**, quyết định daemon có buộc kết nối app đi qua kiểm tra quyền Hub hay không.

|                                  | `off`                                             | `external`                                   |
| -------------------------------- | ------------------------------------------------- | -------------------------------------------- |
| Kết nối app                      | Luồng Paseo tin cậy thông thường                  | Cần vé truy cập do Hub cấp                   |
| Hub Connect                      | Kiểm soát việc Hub đưa thông tin kết nối          | Cần có để xin vé kết nối daemon              |
| Quyền trên daemon sau kết nối    | Session tin cậy có quyền owner của daemon         | Theo người đăng nhập, Team và các grant      |
| Giới hạn Project trong Hub       | Không được daemon áp dụng cho session tin cậy này | Daemon kiểm tra Project và thao tác được cấp |
| App upstream không hỗ trợ vé Hub | Có thể dùng luồng ghép nối thông thường           | Không kết nối ngoài được bằng luồng đó       |

## Off có phải ai cũng kết nối được?

Không phải cứ biết daemon là vào được: vẫn cần đường kết nối hợp lệ, thông tin ghép nối và điều kiện xác thực của endpoint nếu có. Nhưng người có pairing link/QR/thông tin kết nối hợp lệ có thể dùng app Paseo tương thích mà không cần đăng nhập Hub.

Với `off`, việc là Member hay chỉ được Connect trên Hub **không biến session daemon thành session giới hạn theo Project**. Đừng dùng chế độ này để chia quyền nhiều người theo Hub.

## Bật external

1. Enroll daemon, kiểm tra Owner kết nối được bằng app hỗ trợ Managed Access.
2. Owner vào Settings → **Hosts → [Host] → Managed access**.
3. Bật **Require Hub access externally**.
4. Kết nối lại; kiểm tra bằng Member chỉ được cấp một Project.

Thay đổi mode áp dụng ngay, **không cần restart daemon**. Kết nối ngoài không có vé bị đóng và phải kết nối lại qua Hub. Nếu vừa cập nhật mã nguồn/binary thì vẫn phải khởi động lại để nạp phiên bản mới; đó là việc khác với đổi mode.

`external` áp dụng cả TCP localhost, LAN, Tailscale, SSH tunnel và relay. Socket/pipe local của hệ điều hành là đường quản trị/khôi phục riêng; kết nối dịch vụ Hub có danh tính và quyền riêng.

## Tắt external

Owner tắt cùng công tắc trên. Khi về `off`, các giới hạn Member/Project của Hub không còn bảo vệ session ghép nối thông thường. Thu hồi Access trên Hub không thay thế thu hồi các đường tin cậy cũ trong chế độ này.

App chỉ hiện quyền đổi công tắc cho Owner. Tuy nhiên **Daemon Administrator có quyền cấu hình daemon ở backend**, bao gồm Managed Access; việc ẩn công tắc không thu hẹp quyền quản trị đó. Xem [phạm vi Administrator](../access/daemon-administrator.md).
