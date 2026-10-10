# Nâng cấp Clisbot 0.1.x lên v2

[User guide](../README.md) · [Bắt đầu nhanh](quick-start.md) · [Q&A](../help/faq.md)

V2 giữ tên npm `clisbot`, lệnh `clis` và home mặc định `~/.clisbot`. Cần Node.js 22.19 trở lên.

```bash
npm install -g clisbot@latest
npx --yes clisbot@latest onboard
```

Dùng `npx` để chắc chắn chạy CLI v2, kể cả khi `~/.clisbot/bin/clisbot` còn trỏ về bản cũ. Home khác: thêm `--home /đường/dẫn`. Sau đó mở link ghép nối được in ra, như ở [bắt đầu nhanh](quick-start.md#mở-trên-web-hoặc-điện-thoại).

Nếu v1 do systemd/launchd tự khởi động, dừng service đó trước.

## Onboard làm gì với home cũ

- **Sao lưu** cấu hình, trạng thái và credential tạm của v1 vào `<home>/backups/`.
- **Dừng v1** khi xác minh được tiến trình thuộc home này; không chắc thì dừng lại, không chạy v2. Không đụng tới session tmux.
- **Tạo `config.json`** cho v2 nếu chưa có. `clisbot.json` của v1 giữ nguyên. `config.json` hợp lệ giữ nguyên; file lỗi được sao lưu rồi tạo mới.
- **Đăng ký thư mục làm việc cũ thành Project**, không sửa file. Code, `MEMORY.md`, `SOUL.md`, `USER.md`… giữ nguyên.

Kết quả ghi ở `<home>/v1-upgrade.json` (không chứa token). Thư mục backup có thể chứa credential, giữ riêng tư.

## Cần làm lại bằng tay

- **Slack/Telegram/Zalo:** v2 quản lý channel trong Hub và chưa tự chuyển cấu hình cũ. Chạy `clisbot hub start`, hoàn tất Account, tạo Connection bằng token cũ, đặt Rules cho group/DM và người được phép, rồi liên kết owner khi được hỏi.
- Không tự chuyển: session tmux đang chạy, prompt đang chờ, loop, tham số runner, biến môi trường provider tùy chỉnh, đăng nhập Zalo Personal.
- Lịch sử của provider có thể nhập riêng bằng `clisbot import` nếu provider hỗ trợ.
- Hướng dẫn trong workspace còn nhắc lệnh CLI cũ thì cần sửa tay.

## Khi có lỗi

- Onboard báo lỗi bàn giao: v2 chưa chạy. Sửa tiến trình hoặc file được nêu, rồi chạy lại onboard.
- V2 đã chạy nhưng bước sau lỗi: xem `clisbot status` và `<home>/daemon.log`.
- Quay về v1: dừng v2 (`clisbot daemon stop`), cài lại bản npm cũ, khôi phục wrapper và credential từ backup. Thay đổi làm trong v2 không chuyển ngược về v1.
