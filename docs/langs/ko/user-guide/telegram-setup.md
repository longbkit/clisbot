[English](../../../user-guide/telegram-setup.md) | [한국어](./telegram-setup.md)

# Telegram bot 설정

## 목적

이 가이드는 다음이 필요할 때 봅니다.

- BotFather로 Telegram bot 만들기
- 그 bot token으로 `clisbot` 시작하기
- direct message에서 bot 테스트하기
- bot을 Telegram group에 추가하기
- Telegram forum topic 하나만 따로 route하기
- 자주 만나는 Telegram setup 문제 해결하기

이 가이드는 `clisbot`이 이미 설치되어 있고 `clisbot start`를 실행할 수 있다고 가정합니다.

## 이 가이드를 마치면 할 수 있는 것

1. Telegram DM에서 bot에게 메시지 보내기
2. DM pairing 승인하기
3. bot을 Telegram group에 추가하기
4. 그 group을 `clisbot`에 route하기
5. 필요하면 topic 하나만 따로 route해서 격리하기

## 가장 짧은 경로

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --telegram-bot-token <your-telegram-bot-token> \
  --persist
```

그다음:

1. Telegram에서 bot에게 DM 보냄
2. `clisbot pairing approve telegram <CODE>`로 pairing code 승인
3. bot을 group에 추가
4. 그 group이나 topic에서 `/whoami` 실행
5. `clisbot routes add --channel telegram group:<chatId> --bot default` 또는 `clisbot routes add --channel telegram topic:<chatId>:<topicId> --bot default`
6. 그 routed surface가 현재 그 bot에 기본값으로 할당된 agent와 다른 agent를 써야 할 때만 `clisbot routes set-agent --channel telegram group:<chatId> --bot default --agent <id>` 또는 `clisbot routes set-agent --channel telegram topic:<chatId>:<topicId> --bot default --agent <id>`로 override

## 1단계: BotFather에서 bot 만들기

Telegram에서 `@BotFather`와 대화합니다.

실행:

```text
/newbot
```

그다음 BotFather 안내에 따라:

1. display name 고르기
2. `bot`으로 끝나는 고유 username 고르기
3. BotFather가 준 token 복사하기

이 token이 `--telegram-bot-token` 값입니다.

유용한 BotFather command:

- `/mybots`: 기존 bot 다시 열기 / 확인
- `/setjoingroups`: bot의 group 참여 허용/차단
- `/setprivacy`: group에서 bot이 얼마나 볼 수 있는지 제어

## 2단계: Telegram token으로 `clisbot` 시작

처음부터 새로 시작한다면:

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --telegram-bot-token <your-telegram-bot-token> \
  --persist
```

이 명령이 하는 일:

- 필요하면 기본 `clisbot` config 생성
- 필요하면 첫 기본 agent 생성
- Telegram enable
- `--persist`를 썼으므로 token을 canonical credential file에 저장

먼저 저장 없이 시험해 보고 싶다면:

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --telegram-bot-token <your-telegram-bot-token>
```

확인할 명령:

```bash
clisbot status
clisbot logs
```

`clisbot status`에서 기대하는 것:

- `Telegram bot default: ...`
- `telegram enabled=yes`
- `connection=active`

## 3단계: Telegram DM 테스트

Telegram에서 bot에게 direct message를 보냅니다.

기본적으로 Telegram DM은 pairing mode입니다.

예상 흐름:

1. 사용자가 DM 전송
2. bot이 pairing code 반환
3. shell에서 그 code 승인

승인:

```bash
clisbot pairing approve telegram <CODE>
```

그다음 다음과 같이 테스트합니다.

```text
hello
```

좋은 첫 테스트:

- `hello`
- `/status`
- `/whoami`

route가 bind된 뒤에는 `/whoami`가 `sessionId`와 persistence 여부도 보여 주므로 session 확인용으로도 좋습니다.

## 4단계: Telegram group에 bot 추가

원하는 Telegram group 또는 supergroup에 bot을 추가합니다.

그다음 group 안에서 다음 중 하나를 실행합니다.

- `/start`
- `/status`
- `/whoami`

이유:

- group이 아직 route되지 않았어도 `clisbot`은 최소 onboarding help를 제공할 수 있음
- `/whoami`가 정확한 `chatId`를 확인하는 가장 쉬운 방법임
- forum topic에서는 `/whoami`가 `topicId`도 보여 줌

중요한 Telegram 동작:

- 일반 group은 `chatId`만 있으면 됨
- forum topic은 `chatId`, `topicId` 둘 다 필요함
- General topic은 대개 `topicId: 1`

## 5단계: group route 추가

`chatId`를 알게 되면 group route를 추가합니다.

```bash
clisbot routes add --channel telegram group:<chatId> --bot default
```

예시:

```bash
clisbot routes add --channel telegram group:-1001234567890 --bot default
```

이 group route는 현재 이 bot에 기본값으로 할당된 agent를 사용합니다.

그 group이 현재 이 bot에 기본값으로 할당된 agent와 다른 agent를 써야 할 때만:

```bash
clisbot routes set-agent --channel telegram group:-1001234567890 --bot default --agent support
```

명시적 mention 없이도 group에서 동작하게 하려면:

```bash
clisbot routes add --channel telegram group:-1001234567890 --bot default
clisbot routes set-require-mention --channel telegram group:-1001234567890 --bot default --value false
```

실전 기본값:

- bot을 조용하게 유지하고 싶다면 `requireMention`을 켜 두는 편이 좋음
- 계속 대화에 참여하는 participant처럼 동작시키고 싶을 때만 끄는 편이 좋음

## 6단계: Telegram topic 만들고 route하기

forum-style supergroup이라면 topic 하나만 따로 격리할 수 있습니다.

먼저 Telegram에서 topic을 만든 뒤 그 topic 안에서:

```text
/whoami
```

다음 값을 복사합니다.

- `chatId`
- `topicId`

그 topic만 추가:

```bash
clisbot routes add --channel telegram topic:<chatId>:<topicId> --bot default
```

예시:

```bash
clisbot routes add --channel telegram topic:-1001234567890:42 --bot default
```

이 topic route도 현재 이 bot에 기본값으로 할당된 agent를 사용합니다.

그 topic이 현재 이 bot에 기본값으로 할당된 agent와 다른 agent를 써야 할 때만:

```bash
clisbot routes set-agent --channel telegram topic:-1001234567890:42 --bot default --agent support
```

topic route 구조:

- parent group route: `bots.telegram.default.groups.<chatId>`
- topic route: `bots.telegram.default.groups.<chatId>.topics.<topicId>`
- topic은 parent group 동작을 override할 수 있음

## 7단계: Telegram 테스트 체크리스트

다음 순서대로 진행합니다.

1. `clisbot status`
2. bot에 DM 보내기
3. `clisbot pairing approve telegram <CODE>`로 pairing 승인
4. DM reply 확인
5. 대상 group에 bot 추가
6. group에서 `/whoami`
7. `clisbot routes add --channel telegram group:<chatId> --bot default`
8. 그 group route가 현재 그 bot에 기본값으로 할당된 agent와 다른 agent를 써야 할 때만 `clisbot routes set-agent --channel telegram group:<chatId> --bot default --agent <id>`
9. group에 일반 test prompt 보내기
10. topic을 쓴다면 topic 안에서 `/whoami`
11. `clisbot routes add --channel telegram topic:<chatId>:<topicId> --bot default`
12. 그 topic route가 현재 그 bot에 기본값으로 할당된 agent와 다른 agent를 써야 할 때만 `clisbot routes set-agent --channel telegram topic:<chatId>:<topicId> --bot default --agent <id>`
13. topic에 일반 test prompt 보내기

좋은 테스트 prompt:

- `hello`
- `reply with exactly PONG`
- `/status`
- `/whoami`

## Privacy Mode와 group visibility

Telegram bot은 대개 Privacy Mode가 켜진 상태로 시작합니다.

이는 group의 일반 메시지를 bot이 얼마나 볼 수 있는지에 영향을 줍니다.

실전 규칙:

- group route가 `requireMention: true`를 유지한다면 Privacy Mode가 켜져 있어도 보통 괜찮음
- group 전체의 더 넓은 대화를 bot이 봐야 한다면 BotFather에서 Privacy Mode를 끄거나, 충분한 group 권한을 부여해야 함

Privacy Mode를 바꾼 뒤에는:

1. BotFather에서 설정 변경
2. Telegram 동작이 갱신되지 않으면 bot을 group에서 제거 후 다시 추가

## setup 중 유용한 명령

```bash
clisbot status
clisbot logs
clisbot pairing approve telegram <CODE>
clisbot routes add --channel telegram group:<chatId> --bot default
clisbot routes set-agent --channel telegram group:<chatId> --bot default --agent <id>
clisbot routes add --channel telegram topic:<chatId>:<topicId> --bot default
clisbot routes set-agent --channel telegram topic:<chatId>:<topicId> --bot default --agent <id>
```

## 문제 해결

### DM에서 bot이 응답하지 않는다

확인:

1. `clisbot status`
2. `clisbot logs`
3. pairing code를 승인했는지

흔한 원인:

- Telegram channel이 아직 active가 아님
- pairing code를 승인하지 않음
- token이 틀림

### `clisbot status`는 멀쩡한데 group에서 bot이 침묵한다

흔한 원인:

- Telegram DM만 설정했고
- 대상 group은 `bots.telegram.default.groups`에 추가되지 않음

해결:

1. group에서 `/whoami`
2. `chatId` 복사
3. `clisbot routes add --channel telegram group:<chatId> --bot default`

### 특정 topic에서만 bot이 침묵한다

흔한 원인:

- parent group은 있음
- 그 topic route는 없음

해결:

1. topic 안에서 `/whoami`
2. `topicId` 복사
3. `clisbot routes add --channel telegram topic:<chatId>:<topicId> --bot default`

### Telegram이 다른 process가 `getUpdates`를 호출 중이라고 말한다

같은 token을 다른 Telegram runtime이 polling 중이라는 뜻입니다.

해결:

1. 같은 token을 쓰는 다른 runtime 중지
2. bot token 하나당 polling process 하나만 유지
3. `clisbot` restart

### bot이 명시적으로 mention했을 때만 답한다

정상 동작일 수 있습니다.

- `requireMention: true`면 명시적 호출을 기대함
- Privacy Mode도 group에서 bot이 보는 범위를 제한할 수 있음

더 넓게 반응시키고 싶다면:

1. `--require-mention false`로 route를 다시 만들거나 config를 수정
2. BotFather Privacy Mode 재확인

### token이나 config를 바꿨는데 동작이 안 바뀐다

```bash
clisbot restart
clisbot status
```

## 관련 문서

- [사용자 가이드](./README.md)
- [봇과 자격 증명](./bots-and-credentials.md)
- [라우트와 채팅 표면](./channels.md)
