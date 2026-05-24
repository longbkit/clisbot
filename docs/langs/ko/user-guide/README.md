[English](../../../user-guide/README.md) | [Tiếng Việt](../../vi/user-guide/README.md) | [简体中文](../../zh-CN/user-guide/README.md) | [한국어](./README.md)

# 사용자 가이드

## 목적

`docs/user-guide/`는 운영자와 bot setup 담당자를 위한 문서 묶음입니다.

이 문서군은 다음을 이해하도록 돕습니다.

- bot을 어떻게 시작하는가
- 어떻게 점검하고 문제를 찾는가
- credentials, routes, auth, agents를 어떻게 관리하는가
- Slack, Telegram, Zalo Bot, Zalo Personal에서 각각 무엇을 조심해야 하는가

## 먼저 볼 문서

- [라우트와 채팅 표면](./channels.md)
- [Surface Access Model](./surface-access-model.md)
- [봇과 자격 증명](./bots-and-credentials.md)
- [CLI 명령](./cli-commands.md)
- [Runtime 운영](./runtime-operations.md)
- [권한과 역할](./auth-and-roles.md)

## 자주 쓰는 setup 문서

- [Telegram bot 설정](./telegram-setup.md)
- [Slack app 설정](./slack-setup.md)
- [Zalo Bot Setup](./zalo-bot-setup.md)
- [Zalo Personal](./zalo-personal.md)
- [Codex CLI 가이드](./codex-cli.md)
- [Claude CLI 가이드](./claude-cli.md)
- [Gemini CLI 가이드](./gemini-cli.md)

## 가장 짧은 시작 경로

```bash
clisbot start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token> --persist
```

시작 후 우선 기억할 복구/점검 명령:

- `clisbot status`
- `clisbot logs`
- `clisbot watch --latest`
- `clisbot inspect --latest`
- `clisbot restart`

## 이 묶음 안의 문서

- [에이전트 진행 상황 응답](./agent-progress-replies.md)
- [권한과 역할](./auth-and-roles.md)
- [봇과 자격 증명](./bots-and-credentials.md)
- [라우트와 채팅 표면](./channels.md)
- [Surface Access Model](./surface-access-model.md)
- [Claude CLI 가이드](./claude-cli.md)
- [CLI 명령](./cli-commands.md)
- [Codex CLI 가이드](./codex-cli.md)
- [Gemini CLI 가이드](./gemini-cli.md)
- [CLI 고유 명령](./native-cli-commands.md)
- [Runtime 운영](./runtime-operations.md)
- [Slack app 설정](./slack-setup.md)
- [슬래시 명령](./slash-commands.md)
- [Telegram bot 설정](./telegram-setup.md)
- [Zalo Bot Setup](./zalo-bot-setup.md)
- [Zalo Personal](./zalo-personal.md)
- [Generic README Backup](../../../user-guide/generic-readme.md) (English source)

## 추천 읽기 순서

1. Telegram 또는 Slack setup 완료
2. `bots`, `routes`, `auth`, `agents` 구조 이해
3. 문제 발생 시 `runtime-operations.md`, `cli-commands.md`로 이동
