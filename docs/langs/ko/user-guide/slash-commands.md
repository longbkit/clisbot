[English](../../../user-guide/slash-commands.md) | [한국어](./slash-commands.md)

# Slash Commands

## 상태

현재 runtime command inventory입니다.

이 페이지는 chat-surface command의 canonical overview이자, auth 계획을 세울 때 빠르게 참고하는 문서입니다.

## 사실 기준

- Parser와 help text: `src/agents/commands/commands.ts`
- canonical help renderer: `renderAgentControlSlashHelp()`

이 페이지와 runtime이 다르면 runtime이 기준입니다.

## 진입 규칙

- 표준 slash command는 `/...`를 씁니다
- 추가 prefix로 `::...`, `\...`도 있습니다
- Bash shortcut prefix는 `!...`입니다
- 여기서 인식하지 못하는 slash command는 agent에게 그대로 전달됩니다

## 기본

- `/start`: 현재 surface에 맞는 onboarding help 표시
- `/status`: route 상태와 operator의 다음 행동 제안 표시
- `/help`: 사용 가능한 control slash command 표시
- `/whoami`: 현재 platform, route, sender identity, 그리고 현재 대화에 저장된 `sessionId` 표시
- `/transcript`: route의 `verbose` 정책이 허용하면 현재 session transcript 표시

## Run 제어

- `/attach`: 이 thread를 active run에 다시 붙이고 live update 재개
- `/detach`: 이 thread의 live update는 멈추되 final 결과는 여기 계속 게시
- `/watch every 30s [for 10m]`: settle되거나 timeout될 때까지 일정 간격으로 최신 run 상태 게시
- `/stop`: 현재 conversation session에 Escape를 보내 interrupt하고, active-run state를 비우고, queued prompt가 계속 흐르게 함
- `/new`: 현재 routed conversation에 새 session을 시작하고 새 `sessionId` 저장
- `/nudge`: prompt text를 다시 보내지 않고 현재 tmux session에 Enter 한 번 더 보내기

## 대화 모드

- `/followup status`
- `/followup auto`
- `/followup mention-only` 또는 `/mention`: 현재 대화에서 명시적 mention 요구
- `/followup mention-only channel` 또는 `/mention channel`: 현재 channel / group의 기본값으로 mention-only를 저장하고 즉시 적용
- `/followup mention-only all` 또는 `/mention all`: 현재 bot의 모든 routed conversation 기본값으로 mention-only를 저장하고 즉시 적용
- `/followup pause` 또는 `/pause`
- `/followup resume` 또는 `/resume`
- `/streaming status`
- `/streaming on`
- `/streaming off`
- `/streaming latest`
- `/streaming all`
- `/responsemode status`
- `/responsemode capture-pane`
- `/responsemode message-tool`
- `/additionalmessagemode status`
- `/additionalmessagemode steer`
- `/additionalmessagemode queue`

## Queue와 steering

- `/queue <message>` 또는 `\q <message>`: 같은 session에서 active run 뒤에 durable queued prompt 생성
- `/queue help`: queue용 help와 예시 표시
- `/steer <message>` 또는 `\s <message>`: active run에 steering message를 즉시 주입
- `/queue list`: 아직 시작되지 않은 queued message 표시
- `/queue clear`: running prompt는 건드리지 않고 아직 시작되지 않은 queued message만 비움

## Loops

- `/loop` 또는 `/loop help`: loop help 표시
- `/loop 5m <prompt>`: interval loop 생성
- `/loop 1m --force <prompt>`: policy가 허용하면 5분 미만 interval loop 생성
- `/loop <prompt> every 2h`: 뒤에 붙는 `every ...` 문법으로 interval loop 생성
- `/loop every day at 07:00 <prompt>`: 매일 고정 시각 wall-clock loop 생성
- `/loop every weekday at 07:00 <prompt>`: 평일 고정 시각 wall-clock loop 생성
- `/loop every mon at 09:00 <prompt>`: 특정 요일 wall-clock loop 생성
- `/loop 3 <prompt>`: prompt를 정해진 횟수만큼 실행
- `/loop 5m` 또는 `/loop every day at 07:00`: `LOOP.md`를 쓰는 maintenance mode 실행
- `/loop status`: 현재 session에서 보이는 loop 표시
- `/loop cancel <id>`: loop 하나 취소
- `/loop cancel --all`: 현재 session에서 보이는 loop 전부 취소
- `/loop cancel --app --all`: app 전체의 loop 전부 취소

운영자 참고:

- 현재 surface에 맞는 살아 있는 문법 요약이 필요하면 `/queue help`와 `/loop help`를 직접 써 보게 하는 편이 좋습니다
- queued prompt는 session store에 저장되어 runtime restart 후에도 살아남고, `clisbot queues list`로도 확인할 수 있습니다
- chat `/loop`에서 wall-clock loop 생성은 대화 흐름을 매끄럽게 하기 위해 즉시 처리되며, 응답에는 resolved timezone, local/UTC 기준 next run, exact cancel command가 포함됩니다
- 고급 recurring loop는 `--loop-start <none|brief|full>`도 받을 수 있습니다. 한 loop의 start notification behavior를 override해야 할 때만 `/loop help`의 live example을 확인하면 됩니다
- timezone이 틀렸다면 응답에 나온 cancel command로 loop를 지우고 timezone을 먼저 바로잡은 뒤 다시 만드세요

## Shell

- `/bash <command>`: resolved role이 `shellExecute`를 허용할 때 shell command 실행
- `!<command>`: resolved role이 `shellExecute`를 허용할 때 Bash shortcut

## 메모

- follow-up scope 기본값은 현재 conversation입니다
- `channel` scope는 현재 channel, group, DM container를 뜻합니다
- `all` scope는 현재 bot 전체 routed conversation의 기본값을 뜻합니다
- 이 페이지는 의도적으로 짧고 inventory 중심입니다
- coding CLI의 고유 명령 / skill pass-through는 [CLI 고유 명령](./native-cli-commands.md)에 정리돼 있습니다
- 출력 wording에 대한 자세한 검토는 `docs/research/channels/2026-04-14-slash-command-output-audit.md`에 있습니다
