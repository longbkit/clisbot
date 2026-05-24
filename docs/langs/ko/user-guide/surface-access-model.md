[English](../../../user-guide/surface-access-model.md) | [Tiếng Việt](../../vi/user-guide/surface-access-model.md) | [简体中文](../../zh-CN/user-guide/surface-access-model.md) | [한국어](./surface-access-model.md)

# Surface Access Model

현재 중요한 config mental model은 다음과 같다:

- `app`
- `bots`
- `agents`

각 bot 내부:

- `directMessages`는 one-person surface map
- `groups`는 multi-user surface map
- stored keys는 provider-local raw ids와 `*`를 사용

예시:

- Slack shared surface: `groups["C1234567890"]`
- Telegram group: `groups["-1001234567890"]`
- Telegram topic: `groups["-1001234567890"].topics["42"]`
- DM wildcard default: `directMessages["*"]`

Operator CLI ids는 prefix를 유지한다:

- `dm:<id>`
- `dm:*`
- `group:<id>`
- `group:*`
- `topic:<chatId>:<topicId>`

현재 invariants:

- Slack `channel:<id>`는 compatibility input일 뿐 canonical operator naming이 아니다
- 한 bot 아래 저장 config는 `directMessages`와 `groups` 안에서 raw ids와 `*`만 사용한다
- `group:*`는 한 bot의 default multi-user sender policy node이며 삭제하지 말고 update 또는 disable해야 한다
- `disabled`는 해당 surface의 모든 사람에게 silent라는 뜻이며 owner/admin과 pairing guidance도 포함한다
- owner/admin은 `groupPolicy`/`channelPolicy` admission을 bypass하지 않는다; group이 admitted/enabled 된 뒤에는 sender allowlists를 bypass하지만 `blockUsers`는 여전히 우선한다
- deny message는 모든 multi-user surface에 대해 하나의 human-facing term인 `group`을 의도적으로 사용한다

## 관련 문서

- [라우트와 채팅 표면](./channels.md)
- [봇과 자격 증명](./bots-and-credentials.md)
- [권한과 역할](./auth-and-roles.md)
