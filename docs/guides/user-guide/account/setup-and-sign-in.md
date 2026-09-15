# Thiết lập Hub, đăng nhập và đăng ký

[User guide](../README.md) · [Hồ sơ](profile.md) · [Mật khẩu và recovery](password-and-recovery.md) · [Q&A](../help/faq.md)

Mở Hub trong Paseo web app tại **Settings → Account**. App native và desktop mở cùng trang này trên trình duyệt để đăng nhập rồi quay lại app.

Màn **Welcome** (khi chưa có Host nào) cũng có ô **Paseo Hub** để đăng nhập, bên cạnh các cách thêm Host trực tiếp. Đăng nhập ở đây xong, nếu tổ chức đã có Host bạn dùng được thì app vào thẳng workspace; nếu chưa có hoặc tài khoản còn thiếu bước (chọn tổ chức, đổi mật khẩu…) thì app mở **Settings → Account** để bạn làm tiếp.

## Người vận hành: bật Google và chọn cách đăng ký

Đặt các biến sau trong môi trường chạy Hub rồi restart Hub:

```dotenv
CLISBOT_GOOGLE_AUTH_CLIENT_ID=...apps.googleusercontent.com
CLISBOT_GOOGLE_AUTH_CLIENT_SECRET=...
CLISBOT_REGISTRATION_MODE=invite_only
CLISBOT_REGISTRATION_ALLOWED_DOMAINS=
```

- **Google:** chỉ bật khi có đủ cả hai biến; thiếu một biến thì Hub không khởi động. Trong Google Cloud Console, thêm Authorized redirect URI đúng `<URL Hub>/api/auth/callback/google`, ví dụ `https://hub.example.com/api/auth/callback/google`.
- **`invite_only`** (Hub cá nhân): chỉ người có lời mời mới tạo được tài khoản.
- **`domain_self_registration`** (Hub công ty): người có email thuộc domain trong `CLISBOT_REGISTRATION_ALLOWED_DOMAINS` (ví dụ `acme.com`) tự đăng ký được. Lời mời vẫn dùng được cho người ngoài domain.
  - Domain khớp chính xác; subdomain phải khai riêng.
  - Không dùng được domain email công cộng như `gmail.com`.
- **Đăng ký bằng email** (chỉ ở `domain_self_registration`): cần cấu hình gửi mail Resend. Domain gửi phải được xác minh trong Resend. Thiếu cấu hình thì chỉ đăng ký được bằng Google hoặc lời mời.

```dotenv
CLISBOT_RESEND_API_KEY=re_...
CLISBOT_RESEND_FROM="Paseo <accounts@acme.com>"
```

Muốn tắt: bỏ hai biến Google, hoặc chuyển về `invite_only`. Tài khoản tạo bằng Google không có mật khẩu, nên sẽ không đăng nhập được cho tới khi bật lại Google.

## Thiết lập Hub lần đầu

Hub mới chưa có tài khoản sẽ hiện **Set up Hub**. Người đầu tiên trở thành Owner và **operator** của Hub.

1. Chọn **Continue with Google** (khuyến nghị): Google đã xác minh email, tài khoản không cần mật khẩu.
   - Ở `domain_self_registration`, nếu email thuộc domain được phép, tổ chức đầu tiên mang tên domain. Đồng nghiệp đăng ký sau sẽ vào đúng tổ chức này.
2. Không dùng Google: chọn **Set up with email and password instead**, nhập email và mật khẩu từ 12 ký tự.
   - Email này không được xác minh.
   - Hub **không tự liên kết Google** vào tài khoản operator này; operator tiếp tục đăng nhập bằng mật khẩu. Lý do: nếu gõ nhầm email thành email của người khác, chủ email đó không thể dùng Google để vào tài khoản operator.
3. Nếu có người thiết lập trước, app báo **This Hub was already set up by someone else**. Đăng nhập bằng tài khoản được mời hoặc tài khoản đã có.

## Đăng nhập

- **Continue with Google:** dùng được khi Hub đã bật Google.
  - Lần đầu, nếu đã có tài khoản mật khẩu cùng email thì Google được liên kết vào tài khoản đó; quyền, tổ chức và dữ liệu giữ nguyên.
  - Nếu tài khoản mật khẩu đó chưa từng xác minh email (ví dụ tạo từ lời mời), Hub đăng xuất các phiên cũ, thu hồi credential CLI và bỏ mật khẩu cũ. Từ đó chỉ đăng nhập bằng Google.
- **Email và mật khẩu:** khi Hub bật Google, màn đăng nhập chỉ hiện **Continue with Google**; bấm **Use email and password instead** để mở form email, kể cả để tạo tài khoản hoặc nhận link đăng ký.
- **Có nhiều tổ chức:** chọn tổ chức sau khi đăng nhập. CLI và Host dùng tổ chức đã chọn.

## Đăng ký tài khoản mới

| Trường hợp                       | Cách làm                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Có lời mời                       | Mở liên kết mời, đăng nhập hoặc tạo tài khoản bằng đúng email được mời, rồi chấp nhận lời mời.                                             |
| Email công ty, Hub bật Google    | **Continue with Google** bằng email công ty. Người đầu tiên của domain là Owner, người sau là Member.                                      |
| Email công ty, không dùng Google | Chọn **Create an account**, nhập email, bấm **Email me a sign-up link**. Mở link trong mail, nhập tên và mật khẩu, bấm **Create account**. |

Về link đăng ký qua email:

- Link sống 30 phút và chỉ dùng được một lần.
- Tài khoản chỉ được tạo sau khi bạn đặt mật khẩu trên trang mở từ link. Người khác gõ email của bạn không tạo được tài khoản hay mật khẩu nào.
- Mỗi email nhận tối đa 1 link mỗi phút và 5 link mỗi giờ.
- App không cho biết email đã có tài khoản hay chưa. Nếu không nhận được mail, thử đăng nhập hoặc hỏi Owner.

## Lỗi thường gặp

| Thông báo                                                                        | Làm gì                                                                                                                 |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| This Google account isn't admitted to this Hub (`registration_closed`)           | Email không có lời mời và domain không được phép. Nhờ Owner mời, hoặc dùng email công ty đúng domain.                  |
| Google hasn't verified this email address (`google_email_unverified`)            | Dùng tài khoản Google có email đã xác minh.                                                                            |
| Linked to a different Hub account (`account_already_linked_to_different_user`)   | Tài khoản Google này đã gắn với một tài khoản Hub khác. Người vận hành xử lý thủ công; Hub không tự gộp hai tài khoản. |
| Hub doesn't link Google to this account automatically (`unable_to_link_account`) | Tài khoản là operator tạo bằng mật khẩu. Đăng nhập bằng mật khẩu.                                                      |
| This Hub was already set up by someone else (`instance_unavailable`)             | Hub đã có operator. Đăng nhập tài khoản của bạn hoặc xin lời mời.                                                      |
| Sign-up link expired / already used                                              | Quay lại **Create an account** và gửi link mới. Link đã dùng rồi thì đăng nhập.                                        |
| This Hub can't send email yet                                                    | Người vận hành chưa cấu hình Resend. Dùng Google hoặc lời mời.                                                         |
| `redirect_uri_mismatch` trên trang Google                                        | Redirect URI trong Google Cloud chưa khớp `<URL Hub>/api/auth/callback/google`.                                        |
