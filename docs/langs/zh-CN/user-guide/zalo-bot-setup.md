[English](../../../user-guide/zalo-bot-setup.md) | [Tiếng Việt](../../vi/user-guide/zalo-bot-setup.md) | [简体中文](./zalo-bot-setup.md) | [한국어](../../ko/user-guide/zalo-bot-setup.md)

# Zalo Bot Setup

## 范围

本页介绍 `clisbot` 中的官方 `zalo-bot` provider。

不包括：

- Zalo OA
- 非官方个人账号自动化

## 创建 Zalo Bot

使用官方 Zalo Bot Creator 流程创建 bot 并获取 bot token。Zalo 的详细官方指南在这里：[Tạo Bot](https://bot.zapps.me/docs/create-bot)。

快速路径：

1. 打开 Zalo，扫描下面的 QR code，进入 Zalo Bot Creator。
2. 创建 bot。Zalo 要求 bot 名称以 `Bot` 开头，例如 `Bot MyShop`。
3. 创建成功后，Zalo 会把 bot 信息和 `Bot Token` 发到你的 Zalo 账号。
4. 在下面的 clisbot setup 命令中，把这个 token 作为 `ZALO_BOT_TOKEN` 使用。

<img src="../../../pics/zalo-bot-creator-qr.jpg" alt="Zalo Bot Creator QR code" width="320" />

## Mental Model

`zalo-bot` 更接近 Telegram，而不是 Slack：

- 一个 bot token
- runtime 以 polling 为主
- 当前 operator 和 queue/loop flow 仅支持 DM
- 没有 topic 或 thread model

当前重要限制：

- outbound text 会按 `2000` 字符切块
- native text send 仅 plain-text；`clisbot` 可以把 markdown input render 成可读 plain text，但 Zalo Bot 不暴露 Telegram HTML 或 Slack mrkdwn 那样的 rich text
- 发送照片目前需要 Zalo 可 fetch 的 absolute HTTP/HTTPS URL；local file path、`file://` URL 或 `localhost` URL 不够
- inbound image 和 sticker message 会下载到 routed workspace 的 `.attachments/` tree，并作为 attachment mentions 传给 agent
- webhook mode 尚未实现；请使用 polling

## 推荐 Dev Flow

Repo-local dev commands 有意使用 `~/.clisbot-dev`。

检查当前 dev runtime：

```bash
bun run status
```

Persist 或 update dev bot token：

```bash
bash ./scripts/run-dev-cli.sh bots set-credentials \
  --channel zalo-bot \
  --bot default \
  --bot-token ZALO_BOT_TOKEN \
  --persist
```

必要时 enable bot：

```bash
bash ./scripts/run-dev-cli.sh bots enable --channel zalo-bot --bot default
```

Restart dev runtime：

```bash
bun run restart
```

## Stored Paths

Dev config:

- `~/.clisbot-dev/clisbot.json`

Dev token file:

- `~/.clisbot-dev/credentials/zalo-bot/default/bot-token`

Runtime logs:

- `~/.clisbot-dev/state/clisbot.log`

## 快速验证

确认 runtime 能看到 channel：

```bash
bun run status
```

预期信号：

- `zalo-bot enabled=yes connection=active`
- `Zalo Bot polling connected for 1 bot(s).`

## DM Pairing Flow

默认 DM policy 是 `pairing`。

手动 flow：

1. 用一个 Zalo account 给 bot 发 DM。
2. 收到 pairing code。
3. Approve：

```bash
clisbot-dev pairing approve zalo-bot <code>
```

4. 再发 DM，预期 routed agent 回复。
5. 可选 media check：向同一个 DM 发一张图片，可带 caption 也可不带。

预期：

- DM 正常 admitted
- routed workspace 在 `.attachments/` 下收到 file
- agent 可通过 prompt 中的 attachment path inspect 图片

## Operator Send Path

直接 operator send：

```bash
clisbot-dev message send --channel zalo-bot --target dm:<user-id> --message "hello"
```

说明：

- direct operator sends 使用 `dm:<user-id>`；raw ids 只作为 DM-compatible send targets 保留
- 不支持 `--thread-id`
- 不支持 `--topic-id`
- `--file /path/to/image.jpg` 目前不会映射到 `zalo-bot` 的 native upload flow，因为官方 `sendPhoto` API 接收 string `photo` field，文档说明为 image path/URL，而不是 multipart upload body
- 如果图片来自 local file，请先 host 到 Zalo 能访问的位置，再把 HTTP/HTTPS URL 传给 `message send`

## Troubleshooting

显示 runtime summary：

```bash
bun run status
```

查看 logs：

```bash
bun run logs
```

常见检查：

- token file 存在且非空
- `bots.zaloBot.defaults.enabled` 为 `true`
- `bots.zaloBot.default.enabled` 为 `true`
- `credentialType` 为 `tokenFile`
- 没有人设置 `mode=webhook`
