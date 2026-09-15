# Tên tổ chức

[User guide](../README.md) · [Thiết lập và đăng nhập](setup-and-sign-in.md) · [Hồ sơ](profile.md)

Mọi thao tác trên Hub (Hosts, Channels, Automations, lời mời, quyền) đều thuộc **tổ chức đang chọn**. Tên tổ chức hiện ở ba chỗ:

- **Đầu sidebar**, phía trên các mục điều hướng. Bấm vào để mở **Settings → Account**.
- **Đầu màn Account**, kèm **Organization ID** (slug) và vai trò của bạn.
- **Màn Approve CLI login**, kèm Organization ID, tài khoản duyệt và những gì CLI được làm trong tổ chức. Kiểm tra đúng tổ chức trước khi bấm **Approve for \<tên tổ chức\>**.

## Đổi tên

Chỉ **Owner** đổi được tên.

1. Vào **Settings → Account**.
2. Ở thẻ tổ chức đầu màn, bấm **Rename**.
3. Nhập tên mới (1–100 ký tự), bấm **Save name**.

Tên mới hiện cho mọi thành viên. Đổi tên không ảnh hưởng quyền, Host đã kết nối hay đăng nhập CLI: CLI và Host gắn với tổ chức theo mã định danh (slug) cố định, slug không đổi theo tên.

Admin và Member không thấy nút **Rename**. Nếu gọi API trực tiếp, Hub trả `organization_owner_required`.

Tổ chức tạo tự động theo domain (ví dụ `acme.com`) cũng đổi tên được. Người đăng ký sau bằng email domain đó vẫn vào đúng tổ chức này.
