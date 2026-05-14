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

## Phạm vi

Guide này chỉ dành cho install/update. Các workflow release, publish, và
deprecate nằm ngoài tài liệu này; hãy dùng release workflow của repo cho các
tác vụ đó.

## Đọc release

Hãy đọc các tài liệu sau khi người dùng hỏi có gì mới, nên thử gì, hoặc cần theo dõi gì:

- [Mục lục release notes](../releases/README.md)
- [Ghi chú phát hành v0.1.52](../../../releases/v0.1.52.md)
- [Ghi chú phát hành v0.1.51](../../../releases/v0.1.51.md)
- [Tổng quan update](README.md)
- [Release guide v0.1.52](../../../updates/releases/v0.1.52-release-guide.md)
- [Release guide v0.1.51](../../../updates/releases/v0.1.51-release-guide.md)
- [Hướng dẫn sử dụng](../user-guide/README.md)

Hãy dùng [Mục lục release notes](../releases/README.md) như sơ đồ phiên bản chuẩn.
Hãy dùng [Tổng quan update](README.md) cho các bản catch-up ngắn hơn.
Nếu migration index, update guide, và release docs vẫn chưa trả lời được câu hỏi sâu hơn, hãy inspect toàn bộ [docs folder](https://github.com/longbkit/clisbot/tree/main/docs), bao gồm `docs/user-guide/`. Nếu local docs không sẵn, hãy fetch hoặc clone GitHub docs rồi đọc đúng file liên quan trước khi trả lời.

## Đường ổn định hiện tại

```text
Path: mọi version trước 0.1.52 -> 0.1.52
Target: clisbot@0.1.52
Update path: direct
Manual action: none
Risk: low
Automatic config update: có cho bản cài trước `0.1.50`; `0.1.52` không thêm schema migration mới nhưng vẫn có thể rewrite config current-schema nếu phát hiện stale short startup-delay override
Breaking change: no
Command: npm install -g clisbot@0.1.52 && clisbot restart
Verify: clisbot status
Release note: ../../../releases/v0.1.52.md
Release guide: ../../../updates/releases/v0.1.52-release-guide.md
```

Đường này bao gồm các bản cài đã phát hành ở `0.1.43`, các bản legacy cũ hơn trước `0.1.43`, các pre-release nội bộ `0.1.44`, và cả bản cài `0.1.50` hoặc `0.1.51` chỉ cần bump package đồng thời dọn stale startup-delay override nếu còn bị ghim.
