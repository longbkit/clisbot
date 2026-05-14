[English](../../../architecture/architecture-overview.md) | [한국어](./architecture-overview.md)

# clisbot 아키텍처 개요

## 문서 정보

- **작성일**: 2026-04-04
- **목적**: 시스템의 최상위 구조를 보여 주고, 기준이 되는 아키텍처 문서로 연결하기
- **상태**: 작업 중인 아키텍처

## 기준 문서

이 문서는 전체 지도를 보여 줍니다. 실제 계약은 아래 상세 문서에서 확인해야 합니다.

- [표면 아키텍처](../../../architecture/surface-architecture.md)
- [런타임 아키텍처](../../../architecture/runtime-architecture.md)
- [도메인 언어](../../../architecture/domain-language.md)

이 개요와 상세 아키텍처 문서가 어긋나면, 상세 문서가 우선합니다.

## 핵심 결정

시스템을 다음 여섯 개의 명시적인 제품 시스템으로 나눠 유지합니다.

- channels
- auth
- control
- configuration
- agents
- runners

이 경계가 이 저장소에서 가장 중요한 아키텍처 규칙입니다.

## 최상위 다이어그램

```text
                                 clisbot

    Humans / clients                           Operators
           |                                      |
           v                                      v
+----------------------+              +----------------------+
|      CHANNELS        |              |       CONTROL        |
|----------------------|              |----------------------|
| Slack                |              | start / stop         |
| Telegram             |              | status / logs        |
| future API / Discord |              | channels / agents    |
|                      |              | pairing / debug      |
|                      |              | gated actions        |
| owns:                |              | owns:                |
| - inbound messages   |              | - inspect            |
| - thread / reply UX  |              | - intervene          |
| - chat-first render  |              | - operator views     |
| - transcript command |              | - operator intervention |
+----------+-----------+              +----------+-----------+
           |                                     |
           +------------------+------------------+
                              |
                              v
                    +----------------------+
                    |    CONFIGURATION     |
                    |----------------------|
                    | clisbot.json         |
                    | env vars             |
                    | route mapping        |
                    | agent defs           |
                    | policy storage       |
                    | workspace defaults   |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |         AUTH         |
                    |----------------------|
                    | roles / permissions  |
                    | owner claim          |
                    | resolution order     |
                    | enforcement contract |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |        AGENTS        |
                    |----------------------|
                    | backend-agnostic     |
                    |                      |
                    | owns:                |
                    | - agent identity     |
                    | - session keys       |
                    | - workspaces         |
                    | - queueing           |
                    | - lifecycle state    |
                    | - follow-up state    |
                    | - memory / tools     |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |       RUNNERS        |
                    |----------------------|
                    | normalize backend    |
                    | quirks into one      |
                    | internal contract    |
                    |                      |
                    | contract:            |
                    | - start / stop       |
                    | - submit input       |
                    | - capture snapshot   |
                    | - stream updates     |
                    | - lifecycle / errors |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |    tmux runner now   |
                    |----------------------|
                    | native CLI in tmux   |
                    | Codex / Claude / ... |
                    | session-id capture   |
                    | resume / relaunch    |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |   Durable runtime    |
                    |----------------------|
                    | tmux sessions        |
                    | workspaces           |
                    | CLI processes        |
                    +----------------------+
```

## 기본 흐름

```text
user message
  -> channel
  -> configuration resolves route + persisted policy inputs
  -> auth resolves effective permissions
  -> agents resolves agent + session key
  -> runner executes native CLI
  -> channel renders clean chat-first output
  -> control can inspect or intervene separately
```

## 영속성 규칙

재시작 뒤에도 반드시 살아남아야 하는 정보만 저장합니다.

현재 durable한 대표 예시는 다음과 같습니다.

- config
- processed event state
- session continuity metadata

현재 session continuity metadata는 의도적으로 작게 유지합니다.

- `sessionKey`
- `agentId`
- `sessionId`
- `workspacePath`
- `runnerCommand`
- `runtime`
- `loops`
- `queues`
- `recentConversation`
- `updatedAt`

tmux pane id, tmux window id, 그 밖의 일시적인 runner artifact를 agents 계층의 기준 상태로 취급하면 안 됩니다.

## 소유권 규칙

- Channels는 사용자와 맞닿는 상호작용과 표현을 소유합니다.
- Auth는 permission 의미, owner claim, 그리고 advisory 동작과 강제 동작 사이의 계약을 소유합니다.
- Control은 운영자용 inspect / intervene surface를 소유하고, 운영자 검사에는 auth 규칙을 가져다 씁니다.
- Configuration은 시스템을 묶어 주는 로컬 control plane이며, 관련 policy config를 저장합니다.
- Agents 계층은 backend에 종속되지 않는 agent, session, workspace 동작을 소유합니다.
- Runners는 backend별 실행 동작을 소유하고, 각종 차이를 하나의 계약 뒤로 정규화합니다.

현재 런타임 이름도 이 분리를 분명히 드러내야 합니다.

- `AgentService`는 런타임 진입점에 있는 얇은 facade입니다.
- `SessionService`는 `agents` 안에서 session을 소유하는 런타임 주체입니다.
- `RunnerService`는 `runners` 안에서 backend 실행을 소유하는 런타임 주체입니다.

현재 코드는 아직 이 분리에 완전히 수렴하지는 않았습니다.

- `src/agents/runtime/runner-service.ts`에 오늘도 `RunnerService` 구현이 남아 있습니다.
- 그 파일 안에는 아직 `SessionService`가 소유해야 할 continuity 작업도 일부 남아 있습니다.
- 위 owner map은 현재 코드가 완전히 정리됐다는 주장이라기보다, 지향해야 할 아키텍처 목표로 읽어야 합니다.

## 왜 이 분리가 중요한가

이 시스템들이 서로 섞이기 시작하면:

- backend 특유의 quirks가 제품 로직으로 새어 나가고
- operator workflow가 사용자-facing channel에 섞이며
- 경계가 흐려져 테스트가 약해지고
- 앞으로 runner를 바꾸는 비용이 커지며
- 안전한 리팩터링이 더 어려워집니다

## 상세 문서

- 사용자와 운영자 surface 규칙은 [surface-architecture.md](../../../architecture/surface-architecture.md)에서 다룹니다.
- agents, runner, persistence, runtime contract 규칙은 [runtime-architecture.md](../../../architecture/runtime-architecture.md)에서 다룹니다.
- canonical vocabulary, 모델 소유권, lifecycle, naming boundary는 [domain-language.md](../../../architecture/domain-language.md)에서 다룹니다.
