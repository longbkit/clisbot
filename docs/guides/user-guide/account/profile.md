# Hồ sơ: tên hiển thị và ảnh đại diện

[User guide](../README.md) · [Thiết lập và đăng nhập](setup-and-sign-in.md)

## Đổi tên và ảnh

1. Mở Paseo web app, vào **Settings → Account**.
2. Ở mục **Profile**, bấm **Edit**.
3. Sửa **Display name** (1–100 ký tự).
4. Dán **Profile image link**, hoặc để trống để bỏ ảnh.
5. Bấm **Save profile**.

Tên và ảnh hiện ở tài khoản Hub, danh sách thành viên và người thao tác trong session. Ảnh không tải được thì app hiện chữ viết tắt của tên.

Hiện chỉ sửa được trên Paseo web app mở cùng địa chỉ với Hub. App native và desktop chưa có mục này.

## Link ảnh được chấp nhận

Hub **chưa có upload ảnh**. Ảnh là một link, và link phải thoả tất cả điều kiện:

- Bắt đầu bằng `https://`.
- Host thuộc danh sách tin cậy, hoặc là subdomain của một host trong danh sách. Mặc định gồm `googleusercontent.com`, `gravatar.com` và `githubusercontent.com`.
- Không chứa tài khoản (`user:pass@`), không ghi port, không dùng địa chỉ IP.
- Dài tối đa 2048 ký tự.

| Link                                                   | Kết quả                                |
| ------------------------------------------------------ | -------------------------------------- |
| `https://lh3.googleusercontent.com/a/...` (ảnh Google) | Được                                   |
| `https://avatars.githubusercontent.com/u/12345`        | Được                                   |
| `https://www.gravatar.com/avatar/<hash>`               | Được                                   |
| `https://i.imgur.com/abc.png`                          | Bị từ chối: host không trong danh sách |
| `http://lh3.googleusercontent.com/a/...`               | Bị từ chối: không phải https           |

Bị từ chối thì app báo **Use an https image link from a host this Hub trusts**.

Hub không kiểm tra link có thật sự là ảnh. Lấy link ảnh Google: mở ảnh đại diện Google của bạn, chọn **Copy image address**.

## Người vận hành: đổi danh sách host

```dotenv
CLISBOT_PROFILE_IMAGE_HOSTS=googleusercontent.com,gravatar.com,githubusercontent.com,cdn.acme.com
```

Restart Hub sau khi đổi. Biến này **thay hẳn** danh sách mặc định, nên liệt kê lại các host mặc định nếu vẫn cần.

Chỉ thêm host bạn tin. Mọi app và Host hiển thị tài khoản sẽ tự tải ảnh, nên chủ của host đó thấy được ai đang xem.
