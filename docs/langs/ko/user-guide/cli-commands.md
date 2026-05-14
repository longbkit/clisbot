[English](../../../user-guide/cli-commands.md) | [한국어](./cli-commands.md)

# CLI Commands

이 페이지는 `clisbot` CLI를 쓰는 운영자용 사용자 가이드입니다.

핵심 질문은 두 가지입니다.

- 어떤 작업에 어떤 command family를 써야 하는가
- 그 command family가 실제로 무엇을 하는가

## 원칙

- 모든 public flag는 kebab-case 사용
- 하나의 명사는 하나의 개념에만 연결
- `list`, `add`, `remove`, `enable`, `disable`, `get-<key>`, `set-<key>`, `clear-<key>`를 일관되게 사용
- `add`는 새 object 생성에만 사용
- `add`가 기존 state를 덮어쓸 상황이면 fail하고 올바른 `set-<key>` command를 안내

## 빠른 이해

- `app`: 전역 runtime 동작
- `bots`: provider bot identity, credentials, provider-level defaults
- `routes`: bot 아래 admit된 inbound surface
- `agents`: 실행 identity, workspace, runner 동작

## Resolution order

- route agent가 bot fallback agent보다 우선
- bot fallback agent가 app default agent보다 우선
- route setting은 먼저 bot에서 상속받고, 그다음 route-specific setting이 override

## 자주 가는 흐름

- 처음부터 시작:
  - `clisbot start ...`
- bot identity 하나 더 추가:
  - `clisbot bots add ...`
- channel / group / topic / DM surface 하나 더 추가:
  - `clisbot routes add ...`
- 특정 surface를 특정 agent에 연결:
  - `clisbot routes set-agent ...`
- bot 전체의 fallback agent 지정:
  - `clisbot bots set-agent ...`
- app-wide default agent 지정:
  - `clisbot agents set-default ...`

## 자주 쓰는 flag

- `--channel <channel-name>`
- `--bot <id>`
- `--agent <id>`
- `--json`
- `--persist`

Bot id rule:

- `--channel`이 있으면 provider-local bot id 사용
- `--channel`이 없으면 fully qualified form 사용
- bot-specific command에서 `--bot`을 생략하면 기본값은 `default`

## Top-level command

- `clisbot start`
- `clisbot restart`
- `clisbot stop`
- `clisbot status`
- `clisbot version`
- `clisbot logs`
- `clisbot update`
- `clisbot bots ...`
- `clisbot routes ...`
- `clisbot agents ...`
- `clisbot auth ...`
- `clisbot message ...`
- `clisbot runner ...`
- `clisbot pairing ...`
- `clisbot loops ...`
- `clisbot queues ...`
- `clisbot init`

## Service lifecycle

- `clisbot start [first-run flags...]`: 필요하면 config bootstrap 후 detached runtime 시작
- `clisbot restart`: stop 후 다시 start
- `clisbot stop [--hard]`: runtime 중지, 필요하면 clisbot socket의 tmux session 전체 정리
- `clisbot status`: runtime, config, log, tmux state, 최근 runner session 확인
- `clisbot logs [--lines N]`: 최근 로그 출력
- `clisbot update --help`: 설치 / 업데이트 가이드 출력
- `clisbot init [first-run flags...]`: runtime 시작 없이 config와 첫 agent bootstrap

## Bots

하나의 bot은 하나의 provider identity입니다.

핵심 command 예시:

```bash
clisbot bots list
clisbot bots add --channel telegram --bot default --bot-token TELEGRAM_BOT_TOKEN --persist
clisbot bots add --channel slack --bot default --app-token SLACK_APP_TOKEN --bot-token SLACK_BOT_TOKEN --persist
clisbot bots set-agent --channel slack --bot default --agent support
clisbot bots set-default --channel telegram --bot alerts
clisbot bots get-credentials-source --channel slack --bot default
clisbot bots set-dm-policy --channel telegram --bot default --policy pairing
```

중요한 동작:

- `bots add`는 bot만 생성
- route는 자동으로 admit하지 않음
- bot이 이미 있으면 fail하고 적절한 `set-*` command로 안내
- `disable`은 config는 유지하되 사용 중지
- `remove`는 config에서 삭제
- `set-agent`는 bot fallback agent 설정

## Routes

하나의 route는 하나의 inbound surface입니다.

예시:

- Slack public / private channel
- Slack DM fallback 또는 특정 DM peer
- Telegram group
- Telegram topic
- Telegram DM fallback 또는 특정 DM peer

대표 command:

```bash
clisbot routes list
clisbot routes add --channel slack group:C1234567890 --bot default
clisbot routes add --channel telegram group:-1001234567890 --bot default
clisbot routes add --channel telegram topic:-1001234567890:42 --bot default
clisbot routes set-agent --channel slack group:C1234567890 --bot default --agent support
clisbot routes set-policy --channel slack group:* --bot default --policy allowlist
clisbot routes add-allow-user --channel slack group:* --bot default --user U_OWNER
```

중요한 동작:

- explicit route agent가 bot fallback보다 우선
- shared surface는 admission gate와 sender policy gate가 분리됨
- `group:*`는 기본 다인 sender policy node
- `disabled`는 owner/admin에게도 silence
- exact route가 `group:*`를 상속해야 한다면 route-local `policy`를 생략하는 편이 맞음

## Agents

하나의 agent는 하나의 execution identity입니다.

핵심 command:

```bash
clisbot agents list
clisbot agents get default
clisbot agents add support --cli claude --bot-type team
clisbot agents set-default default
clisbot agents bootstrap support --bot-type team
clisbot agents response-mode status --agent default
clisbot agents additional-message-mode status --agent default
```

## Auth

```bash
clisbot auth list
clisbot auth show app
clisbot auth get-permissions --sender telegram:1276408333 --agent default --json
clisbot auth add-user app --role owner --user telegram:1276408333
clisbot auth add-permission agent-defaults --role member --permission transcriptView
```

중요한 동작:

- `get-permissions`는 읽기 전용
- `--sender`는 권한 검사, `--user`는 role 부여에 사용
- app `owner`와 `admin`은 부여된 뒤 DM pairing을 우회

## Message tooling

- `clisbot message send ...`
- `clisbot message edit ...`
- `clisbot message react ...`
- `clisbot message read ...`
- `clisbot message search ...`
- `clisbot message poll ...`
- `clisbot message custom ...`

핵심 규칙:

- `message send`는 `--channel`, `--target`, `--message` 또는 `--body-file` 필요
- `message custom <subtree...>`는 shared gateway이고, `custom` 뒤 문법은 선택한 channel plugin이 소유
- provider마다 같은 custom grammar를 강제하지 않으므로 먼저 `clisbot message --help --channel <channel-name>`로 channel-scoped help를 확인
- Slack thread는 `--thread-id`
- Telegram topic은 `--topic-id`
- 기본값은 `--input md`, `--render native`
- Telegram은 `html` / native, Slack은 `mrkdwn` / blocks 쪽이 중요
- `--progress`와 `--final`은 formatting option이 아니라 agent-flow signal

## Runner debugging

```bash
clisbot runner list
clisbot runner inspect --latest
clisbot runner inspect --index 1
clisbot runner watch --latest --lines 20 --interval 1s
clisbot inspect --latest
clisbot watch --latest
```

중요한 동작:

- `inspect --latest`는 가장 최근 admit prompt 기준
- `watch --latest`도 가장 최근 admit prompt 기준
- `watch --next`는 command 시작 뒤의 첫 새 prompt를 기다림
- `status`에는 최근 5개 runner session 요약이 포함됨

## Pairing

```bash
clisbot pairing list telegram
clisbot pairing approve telegram <code>
clisbot pairing reject slack <code>
clisbot pairing clear telegram
```

## Loops

```bash
clisbot loops list
clisbot loops status
clisbot loops create --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --sender slack:U1234567890 every day at 07:00 check CI
clisbot loops cancel --all
```

핵심:

- recurring loop는 runtime scheduler를 위해 persist됨
- `--sender`는 loop 생성 시 필수
- `--progress <count>`는 그 loop 하나만 progress-message 안내를 override함. 생략하면 일반 `clisbot.json` prompt policy를 그대로 쓰고, `0`은 progress update를 끄며, 양수는 최대 횟수를 제한함
- Telegram topic은 `--topic-id`
- channel별 loop extension은 `clisbot loops --help --channel <channel-name>` 또는 `clisbot loops create --help --channel <channel-name>`에서 확인

## Queues

```bash
clisbot queues list
clisbot queues status
clisbot queues create --channel telegram --target group:-1001234567890 --topic-id 4335 --sender telegram:1276408333 review backlog
clisbot queues clear --all
```

핵심:

- `list`는 pending만
- `status`는 pending + running
- `create`는 explicit `--channel/--target`와 `--sender`가 필요
- `--current`는 지원하지 않음
- AI agent가 durable queue 요청을 처리할 때는 provider 문법을 추측하지 말고
  `clisbot queues --help --channel <current-channel>`를 먼저 확인

## Timezone

```bash
clisbot timezone get
clisbot timezone set Asia/Seoul
clisbot timezone doctor
clisbot routes set-timezone --channel telegram group:-1001234567890 --bot default Asia/Seoul
clisbot agents set-timezone --agent support-us America/Los_Angeles
```

## First-run 예시

Telegram personal bot:

```bash
clisbot start \
  --channel telegram \
  --bot-token TELEGRAM_BOT_TOKEN \
  --cli codex \
  --bot-type personal \
  --persist
```

Slack team bot:

```bash
clisbot start \
  --channel slack \
  --app-token SLACK_APP_TOKEN \
  --bot-token SLACK_BOT_TOKEN \
  --cli claude \
  --bot-type team \
  --persist
```
