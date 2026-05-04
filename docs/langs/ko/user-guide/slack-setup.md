[English](../../../user-guide/slack-setup.md) | [한국어](./slack-setup.md)

# Slack app 설정

## 목적

이 가이드는 다음이 필요할 때 봅니다.

- `clisbot`용 Slack app 만들기
- scope를 손으로 쌓는 대신 manifest template 가져오기
- Socket Mode 켜기
- Slack app token / bot token 얻기
- `clisbot` 시작하기
- Slack DM에서 bot 테스트하기
- public / private channel에 bot 추가하기
- 자주 만나는 Slack setup 문제 해결하기

이 가이드는 `clisbot`이 이미 설치되어 있고 `clisbot start`를 실행할 수 있다고 가정합니다.

## 이 가이드를 마치면 할 수 있는 것

1. Slack bot에 DM 보내기
2. DM pairing 승인하기
3. bot을 Slack channel에 초대하기
4. 그 channel을 `clisbot`에 route하기
5. mention flow와 thread follow-up 확인하기

## Manifest template

빠른 경로를 원한다면 이 repo에 들어 있는 template를 사용하면 됩니다.

- [Slack app manifest template](../../../../templates/slack/default/app-manifest.json)
- [Slack manifest guide](../../../../templates/slack/default/app-manifest-guide.md)

실전 추천 순서:

1. manifest file 열기
2. JSON 복사
3. manifest로 Slack app 만들기
4. import 후 app-level Socket Mode token은 별도로 만들기

이 template는 bot-facing scope와 event subscription을 대부분 담고 있으며, sender / channel 이름을 사람이 읽기 좋은 형태로 보여 주는 데 필요한 `users:read`와 `*:read` conversation scope도 포함합니다.

## 가장 짧은 경로

```bash
clisbot start \
  --cli codex \
  --bot-type team \
  --slack-app-token <your-xapp-token> \
  --slack-bot-token <your-xoxb-token> \
  --persist
```

그다음:

1. Slack에서 bot에 DM 보내기
2. `clisbot pairing approve slack <CODE>`로 pairing 승인
3. bot을 Slack channel에 초대
4. `clisbot routes add --channel slack group:<channelId> --bot default`
5. 그 channel이 현재 그 bot에 기본값으로 할당된 agent와 다른 agent를 써야 할 때만 `clisbot routes set-agent --channel slack group:<channelId> --bot default --agent <id>`
6. `@clisbot hello` 테스트

## 1단계: Slack app 만들기

열기:

<https://api.slack.com/apps>

다음 순서가 가장 쉽습니다.

1. `Create New App`
2. `From an app manifest`
3. 대상 workspace 선택
4. [manifest template](../../../../templates/slack/default/app-manifest.json) 내용 붙여넣기
5. app 생성

이후 scope나 event subscription을 바꾸면:

1. 변경 저장
2. workspace에 app 재설치

Slack은 reinstall하기 전까지 새 권한을 실제로 부여하지 않으므로 이 단계가 중요합니다.

## 2단계: Socket Mode 켜고 app token 만들기

`clisbot`은 현재 Slack Socket Mode를 사용합니다.

app을 만든 뒤:

1. app settings 열기
2. `Socket Mode` 활성화
3. app-level token 만들기
4. `connections:write` 권한 부여
5. token 복사

이 token은 다음처럼 시작합니다.

```text
xapp-
```

이 값이 `--slack-app-token`입니다.

구분:

- `xapp-...`: app-level Socket Mode token
- `xoxb-...`: bot user OAuth token

둘 다 필요합니다.

## 3단계: app 설치하고 bot token 복사

Slack workspace에 app을 설치합니다.

그 뒤 bot token을 복사합니다.

이 token은 다음처럼 시작합니다.

```text
xoxb-
```

이 값이 `--slack-bot-token`입니다.

## 4단계: `clisbot` 시작

새로운 첫 실행:

```bash
clisbot start \
  --cli codex \
  --bot-type team \
  --slack-app-token <your-xapp-token> \
  --slack-bot-token <your-xoxb-token> \
  --persist
```

왜 `team`이 Slack에서 좋은 기본값인가:

- Slack은 channel-first인 경우가 많음
- channel / team 단위 shared assistant가 흔한 setup임

먼저 저장 없이 시험하고 싶다면 `--persist`를 빼면 됩니다.

확인:

```bash
clisbot status
clisbot logs
```

`clisbot status`에서 기대하는 것:

- `Slack bot default: ...`
- `slack enabled=yes`
- `connection=active`

## 5단계: Slack DM 테스트

Slack의 bot DM 또는 App Home messages surface를 엽니다.

기본적으로 Slack DM은 pairing mode입니다.

예상 흐름:

1. DM 전송
2. bot이 pairing code 응답
3. 로컬에서 승인

승인:

```bash
clisbot pairing approve slack <CODE>
```

그다음:

```text
hello
```

좋은 첫 테스트:

- `hello`
- `/status`
- `/whoami`

route가 bind된 뒤에는 `/whoami`가 `sessionId`와 persistence 여부도 보여 줍니다.

## 6단계: public channel에 bot 추가

대상 Slack channel에 bot을 초대합니다.

channel id를 찾는 쉬운 방법:

1. Slack에서 channel 열기
2. 링크 복사
3. URL에서 `C...` id 확인

route 추가:

```bash
clisbot routes add --channel slack group:<channelId> --bot default
```

예시:

```bash
clisbot routes add --channel slack group:C1234567890 --bot default
```

mention을 선택 사항으로 만들고 싶다면:

```bash
clisbot routes add --channel slack group:C1234567890 --bot default
clisbot routes set-require-mention --channel slack group:C1234567890 --bot default --value false
```

이 route는 현재 이 bot에 기본값으로 할당된 agent를 사용합니다.

그 channel이 현재 이 bot에 기본값으로 할당된 agent와 다른 agent를 써야 할 때만:

```bash
clisbot routes set-agent --channel slack group:C1234567890 --bot default --agent support
```

실전 기본값:

- bot을 조용하게 두고 싶으면 mention required 유지
- 항상 대화에 참여하는 participant처럼 만들고 싶을 때만 끄는 편이 좋음

## 7단계: private channel에 bot 추가

Private channel도 mental model은 같습니다.

```bash
clisbot routes add --channel slack group:<groupId> --bot default
```

예시:

```bash
clisbot routes add --channel slack group:G1234567890 --bot default
```

이 route도 현재 이 bot에 기본값으로 할당된 agent를 사용합니다.

그 private channel이 현재 이 bot에 기본값으로 할당된 agent와 다른 agent를 써야 할 때만:

```bash
clisbot routes set-agent --channel slack group:G1234567890 --bot default --agent support
```

실전 규칙:

- multi-user Slack surface는 모두 `group:<id>`를 씁니다
- public channel은 보통 `C...`
- private channel / group-style conversation은 보통 `G...`
- legacy `channel:<id>`는 호환용으로만 유지됩니다

## 8단계: Slack 테스트 체크리스트

순서:

1. `clisbot status`
2. bot에 DM
3. `clisbot pairing approve slack <CODE>`로 승인
4. DM reply 확인
5. bot을 대상 channel에 초대
6. `clisbot routes add --channel slack group:<channelId> --bot default`
7. 그 channel이 현재 그 bot에 기본값으로 할당된 agent와 다른 agent를 써야 할 때만 `clisbot routes set-agent --channel slack group:<channelId> --bot default --agent <id>`
8. `@clisbot hello`
9. bot reply thread 열기
10. 같은 thread 안에 plain follow-up reply 하나 보내기

좋은 테스트 prompt:

- `@clisbot hello`
- `@clisbot reply with exactly PONG`
- `@clisbot /whoami`
- 첫 bot reply 뒤에 plain thread follow-up

## 왜 thread follow-up이 중요한가

Slack mention flow와 Slack thread follow-up은 같은 경로가 아닙니다.

- explicit mention은 `app_mention`을 씀
- plain thread follow-up은 해당 `message.*` event subscription이 있어야 함

그래서 manifest와 event subscription이 중요합니다.

public channel에서는:

- `message.channels`

private channel / 다른 conversation 종류에서는:

- `message.groups`
- `message.im`
- `message.mpim`

## setup 중 유용한 명령

```bash
clisbot status
clisbot logs
clisbot pairing approve slack <CODE>
clisbot routes add --channel slack group:<channelId> --bot default
clisbot routes set-agent --channel slack group:<channelId> --bot default --agent <id>
clisbot routes add --channel slack group:<groupId> --bot default
clisbot routes set-agent --channel slack group:<groupId> --bot default --agent <id>
```

## 문제 해결

### Slack이 app token이 잘못됐다고 하거나 Socket Mode가 실패한다

흔한 원인:

- 잘못된 token 종류 사용
- app token이 `xapp-...`가 아님
- `connections:write`가 없음
- Socket Mode가 켜지지 않음

### DM에서는 답하지만 channel에서는 답하지 않는다

흔한 원인:

- Slack runtime은 정상
- bot도 설치됨
- 하지만 channel route가 없음

해결:

```bash
clisbot routes add --channel slack group:<channelId> --bot default
```

그 channel이 현재 그 bot에 기본값으로 할당된 agent와 다른 agent를 써야 할 때만:

```bash
clisbot routes set-agent --channel slack group:<channelId> --bot default --agent <id>
```

### 첫 mention은 되는데 plain thread follow-up이 안 된다

흔한 원인:

- `app_mention`은 있음
- `message.channels` 또는 해당 `message.*` event가 없음

해결:

1. Slack app event subscription 업데이트
2. app reinstall
3. `clisbot` restart

### Slack이 `missing_scope`를 보고한다

흔한 원인:

- app manifest가 바뀜
- reinstall 안 함
- 필요한 scope가 아직 없음

해결:

1. 현재 app을 [manifest template](../../../../templates/slack/default/app-manifest.json)와 비교
2. [manifest guide](../../../../templates/slack/default/app-manifest-guide.md) 확인
3. app reinstall
4. `clisbot` restart

### private channel에서 bot이 침묵한다

흔한 원인:

- bot을 private channel에 초대하지 않음
- `slack-channel` 식으로 잘못 이해함
- route가 없음

### scope나 event를 바꿨는데도 나아지지 않는다

Slack app 변경은 보통 두 단계가 더 필요합니다.

1. Slack에서 app reinstall
2. `clisbot restart`

### Slack reply가 중복된다

가장 흔한 원인:

- 같은 Slack app / workspace에 둘 이상의 `clisbot` runtime이 붙어 있음

## 관련 문서

- [사용자 가이드](./README.md)
- [봇과 자격 증명](./bots-and-credentials.md)
- [라우트와 채팅 표면](./channels.md)
- [Slack manifest template](../../../../templates/slack/default/app-manifest.json)
- [Slack manifest guide](../../../../templates/slack/default/app-manifest-guide.md)
