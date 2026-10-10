# Bắt đầu nhanh

[User guide](../README.md) · [Quản lý Hosts](../hosts/connect-and-manage.md) · [Q&A](../help/faq.md)

**Host** là máy chạy agent và chứa code. Mỗi máy cần ít nhất một agent CLI (Claude Code, Codex…) đã đăng nhập.

## Máy của bạn, dùng app desktop

1. Tải app tại [GitHub Releases](https://github.com/longbkit/clisbot/releases/latest) rồi mở.
2. App tự chạy Host trên máy; không cài thêm gì.
3. Chọn **Add a project**, chọn thư mục code, rồi tạo session.

## Máy của bạn, dùng CLI

Cần Node.js 22.19 trở lên.

```bash
npm install -g clisbot
clisbot
```

CLI hỏi có bật giọng nói không, rồi chọn cách kết nối:

- Máy đã đăng nhập Tailscale: CLI dùng Tailscale; nếu không bật được Tailscale Serve, CLI tự chuyển sang relay.
- Chưa có Tailscale: chọn **Use encrypted relay** để kết nối từ bất cứ đâu, hoặc **Use this machine only**.

CLI chạy Host rồi in QR và **link ghép nối**. Link chỉ dùng cho một thiết bị và hết hạn sau 5 phút.

Các lần sau, kể cả khi cần link mới hoặc sau khi khởi động lại máy, chạy lại `clisbot`. Lệnh dùng lại Host đang chạy (đã dừng thì chạy lại) và in link mới. Máy dùng relay thì chạy `clisbot --relay` để CLI không hỏi lại cách kết nối.

Chạy không cần trả lời, kể cả lần đầu: `clisbot --relay --voice disable`. Không có terminal tương tác, `clisbot` cũng bỏ qua câu hỏi và giữ cấu hình giọng nói đã lưu (tắt nếu cài mới).

## Mở trên web hoặc điện thoại

- **Web:** mở link ghép nối bằng trình duyệt; link mở `app.clisbot.com` và tự kết nối.
- **Điện thoại:** quét QR bằng camera hoặc mở link trên trình duyệt điện thoại. App iOS và Android chưa lên store.
- **Từ app desktop:** vào **Settings → [Host] → Pair a device** để tạo QR cho điện thoại.

## Host ở máy khác (server, máy văn phòng)

1. SSH vào máy đó, chạy `npm install -g clisbot` rồi `clisbot`, chọn Tailscale hoặc relay như trên.
2. Trên app desktop: **Add a Host → Paste pairing link**, dán link vừa in.
3. Trên điện thoại: chạy lại `clisbot` trên máy Host để lấy link mới, rồi quét QR.

Mỗi thiết bị cần một link riêng. Đóng terminal không dừng Host; dừng bằng `clisbot daemon stop`.

## Dùng Hub có sẵn của tổ chức

- **Thành viên:** nhận lời mời qua email, rồi trong app chọn ô **Clisbot Hub** ở màn Welcome (hoặc **Settings → Account**) để đăng nhập. Host được cấp quyền hiện ở **Settings → Hosts**.
- **Thêm máy vào Hub:** máy đó chạy Host trước, rồi chạy `clisbot hub connect https://hub.example.com` và mở URL được in ra. Owner/Admin của tổ chức duyệt; xem [Quản lý Hosts](../hosts/connect-and-manage.md).
