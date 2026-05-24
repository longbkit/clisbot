[English](../../../user-guide/zalo-bot-setup.md) | [Tiếng Việt](../../vi/user-guide/zalo-bot-setup.md) | [简体中文](../../zh-CN/user-guide/zalo-bot-setup.md) | [한국어](./zalo-bot-setup.md)

# Zalo Bot Setup

## 범위

이 페이지는 `clisbot`의 공식 `zalo-bot` provider를 다룬다.

다루지 않는 것:

- Zalo OA
- 비공식 personal-account automation

## Zalo Bot 만들기

공식 Zalo Bot Creator flow로 bot을 만들고 bot token을 받는다. Zalo의 자세한 공식 가이드는 여기에서 볼 수 있다: [Tạo Bot](https://bot.zapps.me/docs/create-bot).

빠른 경로:

1. Zalo를 열고 아래 QR code를 스캔해 Zalo Bot Creator를 연다.
2. bot을 만든다. Zalo는 bot 이름이 `Bot`으로 시작해야 한다. 예: `Bot MyShop`.
3. 생성이 끝나면 Zalo가 bot 정보와 `Bot Token`을 Zalo account로 보내준다.
4. 아래 clisbot setup command에서 이 token을 `ZALO_BOT_TOKEN`으로 사용한다.

<img src="../../../pics/zalo-bot-creator-qr.jpg" alt="Zalo Bot Creator QR code" width="320" />

## Mental Model

`zalo-bot`은 Slack보다 Telegram에 더 가깝다:

- 하나의 bot token
- polling-first runtime
- 현재 operator 및 queue/loop flows는 DM-only
- topic 또는 thread model 없음

현재 중요한 제한:

- outbound text는 `2000`자 단위로 chunk된다
- native text send는 plain-text only; `clisbot`은 markdown input을 읽기 좋은 plain text로 render할 수 있지만, Zalo Bot은 Telegram HTML이나 Slack mrkdwn 같은 rich text를 expose하지 않는다
- photo send는 현재 Zalo가 fetch할 수 있는 absolute HTTP/HTTPS URL을 기대한다; local file path, `file://` URL, `localhost` URL만으로는 부족하다
- inbound image와 sticker messages는 routed workspace `.attachments/` tree로 download되고 attachment mentions로 agent에 전달된다
- webhook mode는 아직 구현되지 않았다; polling을 사용한다

## Preferred Dev Flow

Repo-local dev commands는 의도적으로 `~/.clisbot-dev`를 사용한다.

현재 dev runtime 확인:

```bash
bun run status
```

dev bot token persist 또는 update:

```bash
bash ./scripts/run-dev-cli.sh bots set-credentials \
  --channel zalo-bot \
  --bot default \
  --bot-token ZALO_BOT_TOKEN \
  --persist
```

필요하면 bot enable:

```bash
bash ./scripts/run-dev-cli.sh bots enable --channel zalo-bot --bot default
```

dev runtime restart:

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

## Quick Verify

runtime이 channel을 보는지 확인:

```bash
bun run status
```

기대 signals:

- `zalo-bot enabled=yes connection=active`
- `Zalo Bot polling connected for 1 bot(s).`

## DM Pairing Flow

Default DM policy는 `pairing`이다.

Manual flow:

1. Zalo account에서 bot에게 DM.
2. pairing code 수신.
3. approve:

```bash
clisbot-dev pairing approve zalo-bot <code>
```

4. 다시 DM하고 routed agent reply를 기대.
5. optional media check: 같은 DM에 image 전송, caption 유무 무관.

기대:

- DM이 정상 admitted
- routed workspace가 `.attachments/` 아래 file을 받음
- agent가 prompt에 포함된 attachment path로 image를 inspect 가능

## Operator Send Path

Direct operator send:

```bash
clisbot-dev message send --channel zalo-bot --target dm:<user-id> --message "hello"
```

Notes:

- direct operator sends에는 `dm:<user-id>` 사용; raw ids는 DM-compatible send targets로만 유지
- `--thread-id` 지원 안 함
- `--topic-id` 지원 안 함
- `--file /path/to/image.jpg`는 현재 `zalo-bot`의 native upload flow에 mapping되지 않는다. 공식 `sendPhoto` API는 multipart upload body가 아니라 image path/URL로 document된 string `photo` field를 받기 때문이다
- image가 local file이면 먼저 Zalo가 접근할 수 있는 곳에 host한 뒤 HTTP/HTTPS URL을 `message send`에 전달

## Troubleshooting

runtime summary 보기:

```bash
bun run status
```

logs tail:

```bash
bun run logs
```

Common checks:

- token file이 존재하고 비어 있지 않음
- `bots.zaloBot.defaults.enabled`가 `true`
- `bots.zaloBot.default.enabled`가 `true`
- `credentialType`이 `tokenFile`
- 아무도 `mode=webhook`을 set하지 않음
