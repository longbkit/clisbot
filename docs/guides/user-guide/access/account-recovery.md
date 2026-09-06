# Mật khẩu owner và recovery

[User guide](../README.md) · [Onboarding](../getting-started/onboarding.md)

Các lệnh dùng đúng `--home` đã onboarding. Nếu chạy từ repository, dùng hàm `paseo` ở bước chuẩn bị của [onboarding](../getting-started/onboarding.md#1-chuẩn-bị).

## Còn biết mật khẩu cũ

Nhập kín và export hai biến rồi đổi mật khẩu qua API:

```bash
read -rsp 'Current password: ' CURRENT_OWNER_PASSWORD; printf '\n'
read -rsp 'New password: ' NEW_OWNER_PASSWORD; printf '\n'
export CURRENT_OWNER_PASSWORD NEW_OWNER_PASSWORD
paseo hub password change --home "$HOME/.clisbot-dev-01" \
  --email "$OWNER_EMAIL" \
  --current-password '${CURRENT_OWNER_PASSWORD}' \
  --new-password '${NEW_OWNER_PASSWORD}'
```

Mật khẩu mới tối thiểu 12 ký tự. Các phiên khác bị đăng xuất. `--owner-password` lúc init chỉ tạo account ban đầu, **không reset account đã có**.

## Quên mật khẩu: recovery bằng master password

Recovery mặc định **tắt**. Người vận hành phải cấu hình `CLISBOT_MASTER_PASSWORD` trong môi trường chạy Hub; secret này có quyền reset **mọi password account trên Hub**. Dùng secret ngẫu nhiên 32–1024 ký tự ASCII không khoảng trắng, khác mật khẩu account; giữ trong password manager/file riêng ngoài workspace bot.

Nếu đã lưu trong `.env`, nạp lại file như bước onboarding. Nếu chưa cấu hình, nhập kín secret bạn đã tạo và lưu riêng:

```bash
read -rsp 'Hub master password: ' CLISBOT_MASTER_PASSWORD; printf '\n'
export CLISBOT_MASTER_PASSWORD
paseo hub stop --home "$HOME/.clisbot-dev-01"
paseo hub start --home "$HOME/.clisbot-dev-01"
```

Chỉ Hub cần restart; daemon có thể giữ nguyên. Export chỉ tồn tại trong shell và tiến trình con; chạy Hub bằng service thì cấu hình biến trong service. Đổi/xóa master password cũng cần restart Hub; bỏ biến sẽ tắt recovery.

Khi cần reset:

```bash
read -rsp 'New account password: ' NEW_OWNER_PASSWORD; printf '\n'
export NEW_OWNER_PASSWORD
paseo hub password reset --home "$HOME/.clisbot-dev-01" \
  --email "$OWNER_EMAIL" \
  --master-password '${CLISBOT_MASTER_PASSWORD}' \
  --new-password '${NEW_OWNER_PASSWORD}'
```

Mật khẩu mới 12–128 ký tự, khác master password. Đăng nhập lại sau reset: các phiên account cũ bị thu hồi; bot, file, workspace, quyền, channel token và API key được giữ nguyên. Hiện có CLI/API, chưa có form “Quên mật khẩu” trên web hay recovery qua email.

| Kết quả                  | Làm gì tiếp?                                                          |
| ------------------------ | --------------------------------------------------------------------- |
| `401`                    | Kiểm tra master password đang dùng có khớp biến **Hub đã nạp** không. |
| `404`                    | Kiểm tra bản Hub, recovery đã bật và email account đã tồn tại.        |
| `429`                    | Đợi ít nhất 60 giây; giới hạn 5 lần thử/phút/tiến trình Hub.          |
| Không nhận được xác nhận | Thử đăng nhập bằng mật khẩu mới để biết kết quả trước khi reset lại.  |

CLI chỉ gửi secret qua HTTPS hoặc HTTP loopback; không theo redirect. Master password không được in trong kết quả hay tự truyền vào môi trường agent/terminal. **Bot đọc được `.env`, tiến trình hoặc database Hub vẫn có thể lấy quyền này**; không nhờ bot reset hộ. Đây không phải biện pháp cách ly quyền hệ điều hành.

## Không còn mật khẩu hay master password

Nếu chưa đổi mật khẩu sau init, kiểm tra bản `INITIAL_OWNER_PASSWORD` bạn đã lưu. Nếu là Member, liên hệ người vận hành Hub; không gửi secret qua ticket/chat.

Nếu còn quyền quản trị máy, người vận hành có thể cấu hình master password mới như trên. Giữ và sao lưu home trước khi sửa môi trường. Nếu không còn quyền quản trị hay thông tin recovery, hiện không có cách tự lấy lại account. Có thể dựng Hub mới, tận dụng file workspace còn truy cập được; lịch sử và cấu hình Hub không tự chuyển sang. **Không xóa home cũ để thử reset.**
