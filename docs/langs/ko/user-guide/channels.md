[English](../../../user-guide/channels.md) | [한국어](./channels.md)

# 라우트와 채팅 표면

## 빠른 이해

`clisbot routes ...`는 하나의 bot 아래에 있는 inbound surface를 관리하는 CLI입니다.

route를 볼 때는 두 층으로 생각하면 됩니다.

1. 이 surface를 시스템에 admit할 것인가
2. admit된 뒤 이 surface 안에서 누가 말할 수 있는가

저장된 bot config 안에서는 이 surface가 다음 둘로 나뉩니다.

- `directMessages`
- `groups`

## 권장 CLI route id

Slack:

- shared surface: `group:<id>`
- shared wildcard: `group:*`
- DM: `dm:<userId>`
- DM wildcard: `dm:*`

Telegram:

- shared chat: `group:<chatId>`
- topic: `topic:<chatId>:<topicId>`
- shared wildcard: `group:*`
- DM: `dm:<userId>`
- DM wildcard: `dm:*`

호환성:

- `channel:<id>`는 예전 Slack operator 흐름을 위해 계속 받습니다
- 하지만 저장 config는 bot route map 안에서 그 prefix를 더 이상 쓰지 않습니다

## 저장 config 형태

```json
{
  "bots": {
    "slack": {
      "default": {
        "channelPolicy": "allowlist",
        "groupPolicy": "allowlist",
        "directMessages": {
          "*": {
            "enabled": true,
            "policy": "pairing"
          },
          "U1234567890": {
            "enabled": true,
            "policy": "allowlist",
            "allowUsers": ["U1234567890"]
          }
        },
        "groups": {
          "*": {
            "enabled": true,
            "policy": "open"
          },
          "C1234567890": {
            "enabled": true,
            "policy": "allowlist",
            "allowUsers": ["U_OWNER"]
          }
        }
      }
    },
    "telegram": {
      "default": {
        "groupPolicy": "allowlist",
        "directMessages": {
          "*": {
            "enabled": true,
            "policy": "pairing"
          }
        },
        "groups": {
          "*": {
            "enabled": true,
            "policy": "open",
            "topics": {}
          },
          "-1001234567890": {
            "enabled": true,
            "policy": "allowlist",
            "allowUsers": ["1276408333"],
            "topics": {
              "42": {
                "enabled": true,
                "policy": "open"
              }
            }
          }
        }
      }
    }
  }
}
```

## Policy 규칙

### Shared surface

- `disabled`는 모두에게 침묵함을 뜻합니다
- `groupPolicy` 또는 Slack `channelPolicy`가 `allowlist`라면, 일반 사용자는 그 shared surface 자체가 존재해야 합니다
- admit된 뒤 effective sender policy는 다음이 합쳐집니다
  - `groups["*"]`
  - exact shared route
- `allowUsers`와 `blockUsers`는 runner에 들어가기 전에 검사됩니다
- 기본 admission은 `allowlist`, admit된 group 안의 기본 sender policy는 `open`입니다

### Shared owner/admin 동작

- app `owner`와 app `admin`은 allowlist가 일반 사용자를 막아도 enabled된 shared surface를 사용할 수 있습니다
- `blockUsers`는 여전히 우선합니다
- `disabled`도 여전히 우선합니다

### Shared deny 동작

shared allowlist가 sender를 거부하면 bot은 다음과 같이 답합니다.

`You are not allowed to use this bot in this group. Ask a bot owner or admin to add you to \`allowUsers\` for this surface.`

### DM surface

- `directMessages["*"]`가 일반적인 DM 기본값입니다
- pairing approval은 요청을 받은 bot의 wildcard DM route에 기록됩니다
- exact DM route는 필요할 때 behavior override와 per-user admission override를 함께 가질 수 있습니다

## Invariant

- operator가 주로 써야 할 route id는 `group:<id>`, `group:*`, `dm:<id|*>`, `topic:<chatId>:<topicId>`입니다
- Slack `channel:<id>`는 기존 muscle memory와 오래된 스크립트를 바로 깨지 않기 위해서만 남겨 둡니다
- 저장 config는 더 이상 그 prefix를 쓰지 않습니다
- `group:*`는 기본 multi-user sender policy node이지, 있어도 되고 없어도 되는 편의 alias가 아닙니다
- deny reply는 Slack channel이나 Telegram topic에도 의도적으로 `group`이라는 말을 씁니다

## 자주 쓰는 명령

```bash
clisbot routes list
clisbot routes add --channel slack group:C1234567890 --bot default
clisbot routes add --channel telegram group:-1001234567890 --bot default
clisbot routes add --channel telegram group:-1001234567890 --bot alerts --require-mention false --allow-bots true --policy allowlist
clisbot routes add --channel telegram topic:-1001234567890:42 --bot default
clisbot routes set-agent --channel slack group:C1234567890 --bot default --agent support
clisbot routes set-policy --channel slack group:* --bot default --policy allowlist
clisbot routes add-allow-user --channel slack group:* --bot default --user U_OWNER
clisbot routes add-allow-user --channel telegram group:* --bot alerts --user 1276408333
clisbot routes add-block-user --channel telegram group:-1001234567890 --bot default --user 1276408333
clisbot routes set-policy --channel telegram dm:* --bot default --policy pairing
clisbot routes add-allow-user --channel slack dm:U1234567890 --bot default --user U1234567890
```

## 실전 가이드

- 한 bot 아래의 모든 shared surface에 공통 sender rule을 두고 싶다면 `group:*`를 씁니다
- 한 사용자를 그 bot 아래의 모든 admit된 group에서 허용하고 싶다면 `routes add-allow-user ... group:* ...`를 씁니다
- 새 group route를 만들 때 `--policy allowlist --require-mention false --allow-bots true`를 한 번에 주면 초기 생성이 편합니다
- 한 Slack channel, Slack group, Telegram group, Telegram topic만 admit하고 싶다면 exact shared route를 씁니다
- 새 exact shared route는 현재 그 bot에 기본값으로 할당된 agent를 사용하며, 그 route가 그 현재 기본 agent와 다른 agent로 답해야 할 때만 `routes set-agent ...`를 씁니다
- group은 반드시 명시적으로 추가해야만 쓰게 하고 싶다면 `bots set-group-policy --policy allowlist`를 씁니다
- 특정 group 안에서만 일부 사용자에게 말하게 하려면 `routes set-policy group:<id> --policy allowlist`를 씁니다
- 절대 응답하면 안 되는 surface라면 `disabled`를 유지하는 편이 가장 명확합니다

## 관련 문서

- [봇과 자격 증명](./bots-and-credentials.md)
- [CLI 명령](./cli-commands.md)
- [권한과 역할](./auth-and-roles.md)
- [surface policy 구조 표준화와 0.1.43 호환성](../../../tasks/features/configuration/2026-04-24-surface-policy-shape-standardization-and-0.1.43-compatibility.md)
