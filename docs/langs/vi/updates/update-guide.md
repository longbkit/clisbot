[English](../../../updates/update-guide.md) | [Tiếng Việt](./update-guide.md) | [简体中文](../../../updates/update-guide.md) | [한국어](../../../updates/update-guide.md)

# Hướng dẫn cập nhật clisbot

Hãy dùng tài liệu này sau khi [migration index](../../../../docs/migrations/index.md) cho biết có cần manual action hay không.

`clisbot update` và `clisbot update --help` hiện mới chỉ in hướng dẫn. Chúng chưa tự cài package.
Một bot có thể dùng chính guide này để tự cập nhật.

## Quyết định

```text
stable/latest/default -> npm dist-tag latest
beta                  -> npm dist-tag beta
exact version         -> version do người dùng chỉ định
manual action default -> none
```

Hãy dùng npm dist-tag, không dùng semver cao nhất. Chỉ dùng beta khi người dùng yêu cầu.

## Luồng thực hiện

```text
clisbot status
npm install -g clisbot@<target> && clisbot restart
clisbot status
báo lại version, health, manual action, và các release highlight hữu ích
```

## Khôi phục khi publish nhầm

Nếu một version bị publish nhầm:

1. hãy publish target hoặc tag đúng trước để npm trỏ người dùng về đúng build
2. sau đó mới deprecate version sai
3. bắt đầu bằng `npm login` trong một attached session
4. nếu npm trả về URL duyệt trên trình duyệt, hãy giữ nguyên session đó và tiếp tục ngay trên chính session đó sau khi duyệt xong
5. không chuyển sang `--otp`; hãy giữ luồng duyệt qua trình duyệt hoặc luồng tương tác bình thường, và dừng nếu luồng đó không thể hoàn tất

Ví dụ:

```text
npm deprecate clisbot@0.1.46-beta.1 "Published by mistake. Use clisbot@0.1.50-beta.10 instead."
```

## Đọc release

Hãy đọc các tài liệu sau khi người dùng hỏi có gì mới, nên thử gì, hoặc cần theo dõi gì:

- [Mục lục release notes](../releases/README.md)
- [Ghi chú phát hành v0.1.51](../../../releases/v0.1.51.md)
- [Tổng quan update](README.md)
- [Release guide v0.1.51](../../../updates/releases/v0.1.51-release-guide.md)
- [Hướng dẫn sử dụng](../user-guide/README.md)

Hãy dùng [Mục lục release notes](../releases/README.md) như sơ đồ phiên bản chuẩn.
Hãy dùng [Tổng quan update](README.md) cho các bản catch-up ngắn hơn.
Nếu migration index, update guide, và release docs vẫn chưa trả lời được câu hỏi sâu hơn, hãy inspect toàn bộ [docs folder](https://github.com/longbkit/clisbot/tree/main/docs), bao gồm `docs/user-guide/`. Nếu local docs không sẵn, hãy fetch hoặc clone GitHub docs rồi đọc đúng file liên quan trước khi trả lời.

## Đường ổn định hiện tại

```text
Path: mọi version trước 0.1.51 -> 0.1.51
Target: clisbot@0.1.51
Update path: direct
Manual action: none
Risk: low
Automatic config update: có cho bản cài trước `0.1.50`; `0.1.51` không thêm schema migration mới
Breaking change: no
Command: npm install -g clisbot@0.1.51 && clisbot restart
Verify: clisbot status
Release note: ../../../releases/v0.1.51.md
Release guide: ../../../updates/releases/v0.1.51-release-guide.md
```

Đường này bao gồm các bản cài đã phát hành ở `0.1.43`, các bản legacy cũ hơn trước `0.1.43`, các pre-release nội bộ `0.1.44`, và cả bản cài `0.1.50` chỉ cần bump package để nhận default startup window dài hơn.
