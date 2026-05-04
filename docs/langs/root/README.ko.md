<p align="center">
  <img src="../../../docs/brand/x-profile-banner-2026-04-29/images/clisbot-x-banner-v5-frontier-tagline-1500x500.png" alt="clisbot banner" width="100%" />
</p>

<p align="center">
  <a href="../../../README.md">English</a> |
  <a href="./README.vi.md">Tiếng Việt</a> |
  <a href="./README.zh-CN.md">简体中文</a> |
  <a href="./README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/clisbot"><img src="https://img.shields.io/npm/v/clisbot?label=npm&color=cb3837" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/CLI-Codex%20%7C%20Claude%20%7C%20Gemini-111827" alt="supported cli tools" />
  <img src="https://img.shields.io/badge/Channels-Slack%20%7C%20Telegram-0a66c2" alt="supported channels" />
  <img src="https://img.shields.io/badge/Runtime-tmux%20backed-16a34a" alt="tmux backed runtime" />
  <img src="https://img.shields.io/badge/Workflow-AI--native-f59e0b" alt="AI-native workflow" />
</p>

<p align="center">
  제품 업데이트는 <a href="https://x.com/clisbot">x.com/clisbot</a>에서 확인할 수 있다.
</p>

# clisbot - 좋아하는 coding CLI를 이동 중에도 쓸 수 있는 agentic 개인 비서, 팀 비서, coding 파트너로 바꾸기
OpenClaw를 쓰고 싶지만 이런 점이 걸렸다면:

- API 비용이 너무 높아서 결국 LLM proxy 우회 경로를 찾게 된다
- 일상 업무에는 OpenClaw를 쓰고, 진짜 coding은 다시 Claude / Codex / Gemini로 돌아가야 한다
- 이동 중에도 coding과 일을 계속하고 싶다

`clisbot`은 바로 그 문제를 풀기 위해 만들어졌다.

`clisbot`은 Claude Code, Codex, Gemini CLI 같은 native frontier agent CLI를 Slack과 Telegram에서 오래 살아 있는 bot으로 바꾼다. 각 agent는 자기만의 tmux session 안에서 실행되고, 실제 workspace를 유지하며, coding bot, 일상 업무 어시스턴트, 혹은 SOUL, IDENTITY, MEMORY를 갖춘 팀 어시스턴트처럼 동작할 수 있다.

이건 단순히 tmux를 채팅에 붙인 얇은 브리지 계층이 아니다. `clisbot`은 Slack과 Telegram을 실제 대화 공간으로 다루며, routing, durable conversation state, pairing, follow-up control, 파일 송수신, 그리고 frontier coding agent를 팀이 실제로 일하는 도구와 커뮤니케이션 맥락 안에 그대로 머물게 하는 능력을 갖춘다.

`clisbot`은 앞으로도 같은 durable agent session 위에서 여러 CLI, 여러 채널, 여러 작업 흐름을 지탱할 수 있는 재사용 가능한 agent runtime layer로 성장하는 것을 목표로 한다.

## 목표별 시작점

### Telegram이나 Slack에서 개인 coding bot을 갖고 싶다

- [빠른 시작](#quick-start)부터 보면 된다
- Codex, Claude, Gemini를 채팅에서 바로 쓰고 싶지만 실제 workspace는 포기하고 싶지 않은 경우에 가장 잘 맞는다
- 현재 릴리스의 핵심 가치는 더 강해진 AI-native 제어 경로다. bot이 점점 `/queue`, loop, schedule, 그 밖의 반복 작업을 일반 채팅만으로도 설정할 수 있게 되며, 사용자가 처음부터 명령 문법을 외우지 않아도 되게 만든다

### 팀이 함께 쓰는 공유 bot이 필요하다

- [빠른 시작](#quick-start)부터 보고, 이어서 [대화 공간 접근 모델](#surface-access-model)을 읽으면 된다
- route와 sender control이 분명한 상태로, bot이 실제 Slack channel, Telegram group, Telegram topic 안에서 살아 있어야 하는 경우에 가장 잘 맞는다
- 현재 릴리스의 핵심 가치는 더 안전한 공유 대화 공간 정책, 더 강한 topic / thread 격리, group 단위 sender control, 그리고 bot이 팀 그룹 안에 머물면서도 모두에게 열리지 않게 해 주는 permission boundary다

### 운영 제어와 디버깅이 필요하다

- [자주 쓰는 CLI 명령](#common-cli-commands)부터 보면 된다
- 가장 유용한 표면은 `clisbot status`, `clisbot logs`, `clisbot watch --latest`, `clisbot inspect --latest`, `clisbot queues`다
- 현재 릴리스의 핵심 가치는 실행 상태를 더 잘 보여 주는 `sessionId`, 더 가벼운 runner inventory, 그리고 업데이트 중 restart 동작의 혼란 감소다

### 최근 무엇이 바뀌었는지만 빨리 알고 싶다

- [최근 릴리스 하이라이트](#recent-release-highlights)부터 보면 된다
- 이어서 [v0.1.51 릴리스 노트](../../../docs/releases/v0.1.51.md) 또는 [v0.1.51 릴리스 가이드](../../../docs/updates/releases/v0.1.51-release-guide.md)를 읽으면 된다

## 왜 clisbot을 만들었나

나는 Long Luong(Long)이고, 베트남 1위 버스·기차·항공권·렌터카 예약 플랫폼인 Vexere의 공동창업자이자 CTO다. 우리는 교통 운영사를 위한 SaaS와 티켓 재고 배분 인프라도 함께 만들고 있다. 회사가 300명 규모로 커지고, 그중 100명 이상이 Engineering, Product, Design에 속하게 되면서, 조직 전체에 AI-native 작업 흐름을 실제로 굴릴 수 있는 가장 실용적인 방법을 계속 찾고 있었다.

문제는 AI가 유용한지 아닌지가 아니다. 기업 규모에서 AI를 실제로 작동시키되, 스택이 파편화되거나, 비용이 폭증하거나, 통제 불가능해지지 않게 만드는 것이 문제다. 현실에서는 비용 통제, 작업 흐름이 실제 실행 상태를 얼마나 잘 반영하는지, 팀 접근성, governance, 그리고 frontier AI를 실제 업무가 일어나는 도구와 대화 공간 안으로 끌어오는 문제를 동시에 풀어야 한다.

`clisbot`은 내가 그 답으로 고른 접근이다. 또 다른 고립된 AI 레이어를 만드는 대신, 이미 신뢰하고 쓰고 있는 coding CLI를 durable하고 채팅 안에서 바로 쓰기 좋은 agent로 바꿔, Slack, Telegram, 실제 팀 작업 흐름을 가로질러 일하게 만든다.

## 왜 clisbot인가

- 일상 업무와 실제 coding을 모두 하나의 frontier-agent 스택으로 처리한다. 보조 업무용 제품 하나, 실제 엔지니어링용 제품 하나를 따로 둘 필요가 없다.
- Claude Code, Codex, Gemini CLI처럼 이미 구독 중인 native CLI를 재사용하므로, 별도의 API 비용 중심 스택으로 밀어 넣지 않는다.
- OpenClaw를 인기 있게 만든 두 가지 큰 장점, 즉 memory와 channel-native integration을 흡수한다. 특히 채널별로 깊이 있게 대화와 표현 방식을 다루는 능력을 배운다.
- 단순한 tmux 브리지가 아니다. Slack과 Telegram을 routing, thread / topic continuity, pairing, follow-up control, attachment-aware interaction이 있는 진짜 대화 공간으로 취급한다. 그래서 이동 중에도 실제 coding workspace를 포기하지 않고 일할 수 있다.
- 설계 단계부터 team-first다. `AGENTS`, `USER`, `MEMORY` 기반의 bootstrap context는 개인 비서 흐름만이 아니라 실제 팀 협업 현실을 염두에 두고 만들어졌다.
- 공유 대화 공간 권한 제어가 핵심 기능이다. bot은 팀 group 안에 있을 수 있지만, 네가 허용한 사람에게만 답할 수 있고, 민감한 control action은 명시적인 auth role과 permission 뒤에 남는다.
- coding, 운영, 팀워크, 일반 어시스턴트 업무 모두에 쓸 수 있으며, `!<command>`, `/bash <command>`, `/queue`, `/loop`, `/streaming`, `/mention` 같은 빠른 채팅 제어도 제공한다.
- `v0.1.50`에서 특히 눈에 띄는 변화는 더 나아진 AI-native 제어 경험이다. 일반 채팅만으로 bot에게 업데이트와 변경점 설명, onboarding 지원, bot / agent 추가 및 설정, 반복 schedule과 loop 생성까지 점점 더 맡길 수 있다.

## 누가 쓰면 가장 잘 맞나

- OpenClaw 스타일의 memory, workspace context, skill-oriented operating model을 가진 높은 자율성의 개인 어시스턴트를 원하며, 얇은 chat wrapper 이상의 것을 기대하는 사람
- Telegram이나 Slack 안에서 진짜 coding 어시스턴트를 원하지만, 그걸 위해 전체 작업 흐름을 새로운 웹 제품으로 갈아엎고 싶지 않은 개인 빌더
- group / topic 안전 경계가 분명하고, durable context와 attachment-aware 채팅 작업 흐름을 갖춘 공유 bot이 필요한 팀 리드

<a id="surface-access-model"></a>

## 대화 공간 접근 모델

현재 config를 이해할 때 가장 중요한 mental model은 다음과 같다:

- `app`
- `bots`
- `agents`

각 bot 안에는:

- `directMessages`가 1:1 대화 공간 맵
- `groups`가 다인 대화 공간 맵
- 저장되는 key는 provider-local raw id와 `*`

예시:

- Slack 공유 대화 공간: `groups["C1234567890"]`
- Telegram group: `groups["-1001234567890"]`
- Telegram topic: `groups["-1001234567890"].topics["42"]`
- DM wildcard default: `directMessages["*"]`

운영자용 CLI id는 계속 prefix를 유지한다:

- `dm:<id>`
- `dm:*`
- `group:<id>`
- `group:*`
- `topic:<chatId>:<topicId>`

현재 invariant:

- Slack `channel:<id>`는 호환 입력일 뿐, 정식 운영자 명명은 아니다
- 하나의 bot 아래 저장되는 config는 `directMessages`와 `groups` 안에서 raw id와 `*`만 사용한다
- `group:*`는 한 bot의 기본 다인 sender policy node이며, 제거가 아니라 업데이트하거나 비활성화해야 한다
- `disabled`는 owner/admin과 pairing guidance를 포함해 해당 대화 공간의 모두에게 silence를 의미한다
- owner/admin은 `groupPolicy` / `channelPolicy` admission을 우회하지 못한다. group이 admit되고 enabled된 이후에만 sender allowlist를 우회하며, `blockUsers`는 여전히 우선한다
- deny message는 모든 다인 대화 공간을 위해 사람 기준의 공통 용어 `group`을 의도적으로 사용한다

## 현재 CLI 호환성 스냅샷

`clisbot`은 현재 Codex, Claude, Gemini와 잘 동작한다.

| CLI | 현재 안정성 | 짧은 평 |
| --- | --- | --- |
| `codex` | 현재 가장 좋음 | routed coding work의 기본값으로 가장 강하다. |
| `claude` | 주의사항이 있지만 사용 가능 | bypass-permissions로 띄워도 Claude는 자체적인 plan-approval과 auto-mode 동작을 드러낼 수 있다. |
| `gemini` | 완전 호환 | Gemini는 routed Slack / Telegram workflow를 위한 first-class runner로 지원된다. |

CLI별 운영자 노트:

- [Codex CLI 가이드](../ko/user-guide/codex-cli.md)
- [Claude CLI 가이드](../ko/user-guide/claude-cli.md)
- [Gemini CLI 가이드](../ko/user-guide/gemini-cli.md)

<a id="quick-start"></a>

## 빠른 시작

플랫폼 지원:

- 현재 지원되는 host 환경은 Linux와 macOS다.
- `clisbot`은 현재 `tmux`와 Bash 기반 runtime flow에 의존하므로 native Windows는 아직 지원하지 않는다.
- Windows를 쓴다면 WSL2 안에서 `clisbot`을 실행하라.

대부분의 사용자는 여기서 시작하면 된다:

```bash
npm install -g clisbot
clisbot start \
  --cli codex \
  --bot-type personal \
  --telegram-bot-token <your-telegram-bot-token> \
  --persist
```

토큰을 바로 persist하지 않고 먼저 시험해 보고 싶다면 `--persist`만 빼면 된다.
일상적인 rescue command는 `clisbot stop`, `clisbot restart`,
`clisbot status`, `clisbot logs`다.

다음 단계:

- 보안을 위해 DM은 기본적으로 pairing 모드다.
- `clisbot`은 first-run friction을 줄이기 위한 smart autopairing 경로도 제공한다. 첫 30분 안에 bot에 DM을 보내면, 보통 별도의 pairing round 없이 owner role을 claim하고 바로 사용을 시작할 수 있다.
- `v0.1.50`부터는 AI-native 운영 경험이 훨씬 강해졌다. 채팅 안에서 bot에게 사용법 설명, 자체 업데이트와 변경점 요약, onboarding 지원, 새 bot / agent 생성 및 추가, 반복 작업을 위한 loop와 schedule 설정까지 점점 더 맡길 수 있다.
- `0.1.50` 이전 버전에서 올라오는 기존 config는 첫 실행 시 자동으로 `0.1.50`로 직접 업데이트된다. clisbot은 먼저 `~/.clisbot/backups/` 아래에 backup을 쓰고, 이후 현재 shape에 맞게 config를 다시 쓴다.
- 공유 Slack channel, Slack group, Telegram group, Telegram topic은 별도의 gate를 가진다. 일반 사용자는 `group:<id>`나 `topic:<chatId>:<topicId>` 같은 명시적 route가 있어야 그 대화 공간에서 bot과 대화할 수 있다. 레거시 Slack `channel:<id>` 입력은 호환용으로 계속 허용된다.
- 공유 대화 공간이 admit된 후에는 bot의 기본 shared rule `groups["*"]`와 route-local `allowUsers` / `blockUsers`가 합쳐져 대화 공간별 sender control을 결정한다.
- 이 permission model 덕분에 bot을 팀 group에 넣어도, 그 group 안의 일부 사람에게만 답하도록 운영할 수 있다.
- effective shared policy가 `disabled`이면 owner/admin을 포함해 모두에게 bot이 침묵한다.
- effective shared policy가 `allowlist`이고 sender가 허용되지 않았다면, bot은 runner에 들어가기 전에 먼저 차단한다:
  - `You are not allowed to use this bot in this group. Ask a bot owner or admin to add you to \`allowUsers\` for this surface.`
- group에서 bot과 대화하려면:
  - telegram: bot을 group에 추가한 뒤 그 자리에서 `/start`를 사용하라. bot이 추가해야 할 route를 안내한다. 이미 권한이 있다면, 이 명령을 bot과의 DM으로 가져가서 대신 설정해 달라고 요청해도 된다.
  - slack: 비슷한 흐름이지만 Slack 고유의 slash command 처리가 조금 어색하다. 앞에 공백을 넣은 ` /start`나 별칭 `\start`를 사용하라. 같은 workaround가 ` /streaming on`, `\mention` 같은 다른 slash command에도 적용된다.
  - group conversation은 남용 방지를 위해 기본적으로 mention을 요구하지만, smart follow-up이 잠시 열려 있으므로 매 답변마다 bot을 다시 태그할 필요는 없다. 이 모드 역시 bot에게 직접 바꿔 달라고 할 수 있다.
  - mention 동작을 더 엄격히 하고 싶다면 현재 대화에는 `/mention`, 현재 channel / group 기본값에는 `/mention channel`, 현재 bot 기본값에는 `/mention all`을 사용하라.
  - coding 같은 긴 작업에는 `/streaming on`으로 streaming을 켜고 `/streaming status`로 상태를 확인하라. Slack에서는 ` /streaming on` 또는 `\streaming on`을 사용하라.
- owner 또는 app admin을 더 추가하고 싶다면, 플랫폼 prefix와 channel-native user id를 붙여 명시적으로 grant하라. 예를 들어 `clisbot auth add-user app --role owner --user telegram:1276408333` 또는 `clisbot auth add-user app --role admin --user slack:U123ABC456`.
- `clisbot auth --help`는 이제 role scope, permission set, 사용자 및 권한 add/remove 흐름까지 다룬다.
- app-level auth와 owner-claim에 대한 현재 runtime reality와 목표 모델 사이의 남은 간극은 [Authorization And Roles](../ko/user-guide/auth-and-roles.md)에 설명되어 있다.

가장 짧은 경로보다 단계별 setup 문서가 더 필요하다면:

- Telegram: [Telegram Bot Setup](../ko/user-guide/telegram-setup.md)
- Slack: [Slack App Setup](../ko/user-guide/slack-setup.md)
- 릴리스 히스토리: [CHANGELOG.md](../../../CHANGELOG.md), [release notes](../ko/releases/README.md), [update guide](../ko/updates/update-guide.md), [release guides](../ko/updates/README.md), [migration index](../ko/migrations/index.md)
- Slack app manifest template: [app-manifest.json](../../../templates/slack/default/app-manifest.json)
- Slack app manifest guide: [app-manifest-guide.md](../../../templates/slack/default/app-manifest-guide.md)

그 다음에는:

- `--bot-type personal`은 한 사람을 위한 어시스턴트 하나를 만든다
- `--bot-type team`은 팀, channel, group 작업 흐름을 위한 공유 어시스턴트 하나를 만든다
- literal token input은 `--persist`를 함께 주지 않으면 메모리에만 남는다
- `--persist`는 그 토큰을 canonical credential file로 승격시켜 다음 `clisbot start`에서 재입력 없이 재사용할 수 있게 만든다
- fresh bootstrap은 명시한 channel만 enable한다
- 첫 persist가 끝난 뒤부터는 이후 restart에 그냥 `clisbot start`를 쓸 수 있다

<a id="recent-release-highlights"></a>

## 최근 릴리스 하이라이트

- `v0.1.50`: bot과 직접 대화해 스스로를 관리하게 하는 AI-native 운영 경험이 훨씬 강해졌다. 또한 실제 Slack / Telegram group에서 더 안전한 personal / team bot, 오래된 설치에서의 직접 업데이트, durable queue control, 실제 상태를 더 사실대로 보여 주는 session continuity, 더 안정적인 scheduled loop, 더 강한 trust / restart 동작, 더 엄격한 streaming / session isolation이 들어갔다.
- `v0.1.43`: 더 durable한 runtime recovery, 더 선명한 routed follow-up control, tmux prompt submission 상태를 더 사실대로 보여 주는 점검, 더 나은 queued-start notification, 더 안전한 Slack thread attachment 동작이 포함됐다.

`v0.1.50`가 사용자에게 가장 크게 의미하는 점:

- 가장 큰 변화는 AI-native control이다. 채팅 안에서 bot에게 queue 작업, 반복 brief schedule, 자기 자신 업데이트, 릴리스 변경 설명, setup과 routing 안내를 맡길 수 있으므로 매번 shell로 내려갈 필요가 줄어든다.
- 개인 사용자: 긴 실행에서의 취약한 실패가 줄고, `/queue`와 Telegram 미디어 처리 경험이 좋아졌다
- 공유 bot owner: route safety가 더 분명해지고, 옛 설치에서의 직접 업그레이드가 쉬워졌으며, 그룹 안에 있으면서도 일부 사람에게만 응답하는 더 흥미로운 팀 use case가 열린다
- 운영자: queue visibility, session continuity, 업데이트 중 restart 동작의 신뢰성이 좋아졌고, 문제가 생겼을 때 `watch`와 `inspect`가 더 빠르다

전체 릴리스 노트에는 이 밖에도 config update safety, CLI help, setup docs, runner debugging, route policy behavior, channel-specific polish, 그리고 이번 릴리스 뒤에 놓인 더 넓은 AI-native 작업 흐름 방향 등 많은 유용한 수정과 운영 개선이 담겨 있다.

전체 내용은 여기서 읽을 수 있다:

- [CHANGELOG.md](../../../CHANGELOG.md)
- [릴리스 노트 인덱스](../ko/releases/README.md)
- [v0.1.51 릴리스 노트](../../../docs/releases/v0.1.51.md)
- [v0.1.50 릴리스 노트](../ko/releases/v0.1.50.md)
- [v0.1.43 릴리스 노트](../ko/releases/v0.1.43.md)
- [v0.1.39 릴리스 노트](../ko/releases/v0.1.39.md)

Slack부터 먼저 가고 싶다면:

```bash
clisbot start \
  --cli codex \
  --bot-type team \
  --slack-app-token SLACK_APP_TOKEN \
  --slack-bot-token SLACK_BOT_TOKEN
```

짧은 별칭:

```bash
clis start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token>
```

로컬 repo 경로:

```bash
bun install
bun run start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token> --persist
```

repo-local `bun run start|stop|restart|status|logs|init|pairing`은 `.env`에 의해 `CLISBOT_HOME=~/.clisbot-dev`로 고정되어 있으므로, 로컬 테스트가 실수로 메인 `~/.clisbot` 런타임을 재사용하지 않는다.

기존 설치를 위한 업데이트 메모:

- `v0.1.50` 이전의 오래된 설치는 이제 첫 실행 시 백업을 먼저 쓰고 바로 직접 업데이트되므로, 대부분의 사용자는 수동 migration 없이 업데이트 후 재시작만 하면 된다.
- `v0.1.50`에 올라온 뒤부터는 이후 업그레이드도 더 AI-native하게 느껴질 것이다. 많은 경우 bot에게 `clisbot`을 최신 버전으로 업데이트하라고 말하면, bot이 update guide를 따라 업그레이드를 수행하고 무엇이 바뀌었는지 요약해 줄 수 있다.
- 그래도 업데이트 전에 현재 config를 agent가 먼저 점검해 주길 원한다면, 이 repo 안의 Codex나 Claude에게 review를 부탁하면 된다.
- 수동 package 업그레이드 경로도 이제 더 단순하다:

```bash
npm install -g clisbot && clisbot restart
clisbot --version
```

첫 대화 흐름:

- Slack이나 Telegram에서 bot에게 DM을 보낸다
- 해당 principal이 이미 app `owner` 또는 app `admin`이면 pairing은 bypass되고, bot은 정상적으로 답해야 한다
- 그렇지 않으면 `clisbot`은 DM을 pairing mode로 처리하고 pairing code와 approval command를 돌려준다

승인은 다음으로 한다:

```bash
clisbot pairing approve slack <CODE>
clisbot pairing approve telegram <CODE>
```

Fresh config는 처음에 어떤 agent도 설정되어 있지 않으므로, 첫 `clisbot start`에는 `--cli`와 `--bot-type`이 모두 필요하다. 그래야 첫 `default` agent를 만들 수 있다.
Fresh config는 Slack channel, Telegram group, topic도 미리 넣어 두지 않는다. 이런 route는 `~/.clisbot/clisbot.json`에 직접 추가해야 한다.
`clisbot start`는 bootstrap 전에 항상 명시적인 channel token input을 요구한다. raw value, `MY_TELEGRAM_BOT_TOKEN` 같은 env name, `'${MY_TELEGRAM_BOT_TOKEN}'` 같은 placeholder 모두 가능하다.
메인 bot 옆에 별도의 dev instance를 두고 싶다면 [Development Guide](../../../docs/development/README.md)를 보면 된다.

## Showcase

목표는 terminal transcript 미러가 아니라, 채팅 안에서 바로 쓰는 진짜 agent 대화 공간이다. thread, topic, follow-up behavior, file-aware workflow가 Slack과 Telegram 안에서 자연스럽게 느껴져야 한다.

Slack

![Slack showcase](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/slack-01.jpg)

Telegram

![Telegram topic showcase 1](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-01.jpg)

![Telegram topic showcase 2](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-02.jpg)

![Telegram topic showcase 3](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-03.jpg)

## 중요한 주의사항

벤더가 security와 safety에 강하게 투자한다고 해서 frontier agentic CLI tool 자체가 본질적으로 안전한 것은 아니다. `clisbot`은 이런 도구를 채팅과 작업 흐름을 통해 더 넓게 노출하므로, 전체 시스템을 high-trust software로 취급하고 스스로의 책임하에 사용해야 한다.

## 감사의 말

OpenClaw가 만들어 낸 아이디어, 추진력, 그리고 아주 실용적인 영감이 없었다면 `clisbot`도 존재하지 않았을 것이다. 여기의 많은 configuration, routing, workspace 개념은 OpenClaw를 연구하며 배운 뒤, 다시 `clisbot`만의 방향에 맞게 변형한 것이다. OpenClaw 프로젝트와 커뮤니티에 존중과 감사를 전한다.

## Setup Guide

여전히 가장 쉬운 setup 흐름은 다음과 같다:

1. `clisbot`을 설치한다.
2. 위의 quick start 명령을 실행한다.
3. bot에게 DM을 보낸다. 해당 principal이 이미 app `owner` 또는 app `admin`이 아니라면 pairing을 승인한다.
4. 첫 성공 실행 전까지는 advanced config로 너무 빨리 들어가지 않는다.

repo-guided setup 경로를 원한다면:

1. 이 repo를 clone한다.
2. 이 repo 안에서 Claude Code, Codex, 또는 Gemini CLI를 연다.
3. `clisbot` setup을 도와 달라고 요청한다.

이 repo의 문서는 [User Guide](../ko/user-guide/README.md)를 포함해 계속 최신으로 유지되므로, agent는 repo 안에서 직접 setup, configuration, troubleshooting을 안내할 만큼 충분한 context를 가져야 한다.
무언가 잘못되면 가장 빠른 rescue loop는 보통 `clisbot logs`,
`clisbot status`, `clisbot restart`, 또는 필요 시 `clisbot stop --hard`
후 `clisbot start`다.
또한 bot workspace, 보통 `~/.clisbot/workspaces/default` 안에서
기반 coding CLI를 직접 실행해 보고 그 CLI가 그 위치에서 정상 동작하는지 확인하라.
이것은 bot health를 점검하는 가장 강력한 end-to-end 체크 중 하나다.

모든 것을 직접 구성하고 싶다면:

1. 공식 config template인 [config/clisbot.json.template](../../../config/clisbot.json.template)을 읽는다.
2. migration review를 위해 릴리스된 snapshot이 필요하다면 [config/clisbot.v0.1.43.json.template](../../../config/clisbot.v0.1.43.json.template)와 비교한다.
3. 공식 template을 `~/.clisbot/clisbot.json`으로 복사하고 bots, routes, agents, workspaces, policies를 환경에 맞게 수정한다.
4. tool defaults, startup options, bootstrap templates의 일관성을 위해 CLI로 agent를 추가한다.
5. 첫 성공 실행 이후 안정적인 channel secret은 env var 또는 canonical credential file로 옮기는 것도 좋다.

Channel route setup은 의도적으로 수동이다:

- fresh config는 Slack channel을 자동 추가하지 않는다
- fresh config는 Telegram group이나 topic도 자동 추가하지 않는다
- 노출하고 싶은 정확한 channel, group, topic, DM routing만 추가한다
- 기본 bot credential setup은 [Bots And Credentials](../ko/user-guide/bots-and-credentials.md)에 있다

고급 agent 관리:

- 대부분의 사용자는 `clisbot start --cli ... --bot-type ...` 흐름을 유지하고 first-run이 default agent를 만들게 두는 편이 좋다
- 여러 agent, custom bot default, 수동 route setup flow가 필요하다면 [User Guide](../ko/user-guide/README.md)에 설명된 `clisbot agents ...`, `clisbot bots ...`, `clisbot routes ...` 명령을 사용하라
- README는 low-level 대화 공간을 main onboarding path에 넣지 않는다. 공개적인 first-run 모델은 `--bot-type personal|team`이지 내부 template-mode naming이 아니기 때문이다
- fresh bot config는 여전히 `default` agent를 가리킨다. 첫 번째로 진짜 쓸 agent가 다른 id를 쓴다면 `clisbot bots set-agent ...`로 fallback을 바꾸거나 `clisbot routes set-agent ...`로 route에서 override하라

config가 credential file이 아니라 env name을 가리키게 하고 싶다면, env-backed setup 역시 계속 지원된다:

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --slack-app-token CUSTOM_SLACK_APP_TOKEN \
  --slack-bot-token CUSTOM_SLACK_BOT_TOKEN
```

- 이런 flag는 `${ENV_NAME}` placeholder 형태로 `~/.clisbot/clisbot.json`에 기록된다
- `CUSTOM_SLACK_APP_TOKEN`을 그대로 넘겨도 되고 `'${CUSTOM_SLACK_APP_TOKEN}'`을 넘겨도 된다
- config가 사용자가 직접 선택한 env variable name을 가리키게 하고 싶을 때 이 경로를 쓰면 된다
- env export 세부사항은 quick start에 다 쏟아붓지 말고 [Bots And Credentials](../ko/user-guide/bots-and-credentials.md)에 두는 편이 낫다

## 문제 해결

quick start가 동작하지 않는다면 다음 순서로 확인하라:

- setup 자체가 모호하다면 이 repo 안에서 Claude Code, Codex, Gemini CLI를 열고 로컬 문서를 바탕으로 도와 달라고 요청하라.
- 무엇인가 이상해 보이면 먼저 `clisbot logs`, `clisbot status`,
  `clisbot restart`를 확인하고, 필요하면 `clisbot stop --hard` 후
  `clisbot start`를 시도하라.
- config 동작이 헷갈린다면 먼저 [config/clisbot.json.template](../../../config/clisbot.json.template)을 보고, 그다음 [User Guide](../ko/user-guide/README.md)와 비교하라.
- `clisbot start`가 agent가 하나도 구성되지 않았다고 말하면, 우선 `clisbot start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token>`을 사용하라.
- `clisbot start`가 token ref를 `missing`으로 출력한다면, 토큰을 명시적으로 명령행에 넘기거나 [Bots And Credentials](../ko/user-guide/bots-and-credentials.md)에 나온 env-backed setup으로 전환하라.
- `clisbot status`에 `bootstrap=...:missing` 또는 `bootstrap=...:not-bootstrapped`가 보이면 [User Guide](../ko/user-guide/README.md)의 고급 bootstrap 절차를 따르라.
- Trust는 보통 bot이 자동으로 처리하지만, trust나 startup behavior가 여전히 이상하다면 workspace로 들어가 underlying CLI를 직접 띄워 보라. 예를 들어 `cd ~/.clisbot/workspaces/default` 후 `codex`, `claude`, `gemini`를 직접 실행해라. 그 workspace에서 CLI가 깨끗하게 시작되지 않으면 bot 역시 건강하지 않다.
- Gemini startup이 manual authorization을 기다린다고 나오면, 먼저 Gemini를 직접 인증하거나 `GEMINI_API_KEY` 혹은 Vertex AI credentials 같은 headless auth 경로를 제공하라. `clisbot`은 이제 그런 화면을 healthy ready session이 아니라 startup blocker로 취급한다.
- Codex가 Linux에서 `bubblewrap`이 없다고 경고하면 runtime environment에 `bubblewrap`을 설치하라.
- bot이 답하지 않으면 먼저 `clisbot status`를 확인하라. 건강한 channel은 `connection=active`를 보여야 한다. 계속 `starting`에 머무르면 `clisbot logs`를 보라.
- routed message가 accept되었는데 답이 오지 않으면, 테스트 메시지를 하나 보낸 직후 터미널에서 `clisbot watch --latest --lines 100`을 실행하라. 최신 admitted session의 live tmux runner pane을 보여 주며, 대개 CLI auth 부족, trust prompt, stuck startup, model/provider 오류가 드러난다.
- Codex는 평소 터미널에서 잘 되는데 routed runner가 `Missing environment variable: CODEX_CLIPROXYAPI_KEY`를 보인다면, `clisbot`은 Codex를 detached background process와 tmux session에서 실행한다는 점을 기억하라. `echo $CODEX_CLIPROXYAPI_KEY`가 값을 출력하는 shell에서 `clisbot`을 시작하거나 재시작해야 하며, 아니면 서비스 매니저가 쓰는 환경에 key를 export해야 한다. 기존 tmux runner session은 예전 환경을 유지하므로 수정 후 recycle해야 한다.
- runtime startup이 계속 실패한다면 `clisbot logs`를 실행하고, `clisbot`이 startup failure 때 자동으로 보여 주는 최근 로그 tail을 확인하라.
- `clisbot restart`가 업데이트 중 stop timeout 경고를 띄우면, 먼저 `clisbot status`를 한 번 실행하라. 현재 릴리스에서는 status가 이미 worker exit를 보여 줄 때 보통 clean하게 이어진다. restart 후 runtime이 실제로 내려가 버렸을 때만 진짜 bug로 봐야 한다.
- 일반 restart로 부족하면 `clisbot stop --hard`를 사용해 runtime을 멈추고, 설정된 clisbot socket 아래의 모든 tmux runner session을 죽인 뒤, 올바른 환경이 잡힌 shell에서 다시 시작하라.
- 전체 명령 목록이 필요하면 `clisbot --help`를 실행하라.
- 단계별 운영 문서가 필요하면 [사용자 가이드](../ko/user-guide/README.md)부터 시작하라.
- Slack thread behavior가 너무 eager하게 느껴지면 `/followup pause` 또는 `/followup mention-only`를 써라.
- Slack slash command가 Slack-native command handling과 충돌하면, 앞에 공백을 넣어 ` /bash ls -la`처럼 입력하라.

<a id="common-cli-commands"></a>

## 자주 쓰는 CLI 명령

대부분의 사용자는 처음에 소수의 명령만 알면 충분하다:

- `clisbot start`: bot runtime을 시작하고, 필요하면 기본 first-run setup까지 만든다
- `clisbot restart`: runtime을 깨끗하게 재시작한다. bot이 응답을 멈췄다면 가장 먼저 써 볼 명령이다
- `clisbot stop`: 업데이트, config 변경, 유지보수 전에 runtime을 정상 종료한다
- `clisbot stop --hard`: runtime을 멈추고, 구성된 clisbot socket 아래의 tmux runner session을 모두 죽인다. 오래된 runner pane, 예전 env, stuck session이 일반 restart 후에도 남아 있을 때 사용한다
- `clisbot status`: runtime, 채널, active session이 건강해 보이는지 확인한다
- `clisbot logs`: startup, routing, reply가 이상할 때 최근 runtime 로그를 본다
- `clisbot runner list`: live tmux-backed runner session을 나열해 무엇이 실행 중인지 확인한다
- `clisbot inspect --latest`: 가장 최근 admitted session의 현재 pane 상태를 한 번 캡처한다
- `clisbot watch --latest --lines 100`: 최신 admitted live session으로 곧장 들어가 충분한 문맥과 함께 방금 제출한 메시지를 디버깅한다
- `clisbot watch --index 2`: tmux session 이름을 몰라도 두 번째로 최근 admitted session을 따라간다
- `clisbot queues list`: 앱 전체의 pending durable queued prompt를 본다
- `clisbot queues create --channel telegram --target group:-1001234567890 --topic-id 4335 --sender telegram:1276408333 <prompt>`: 같은 session에 durable queued prompt 하나를 만든다. `control.queue.maxPendingItemsPerSession` 제한(기본 `20`)을 받는다

전체 운영자 명령 레퍼런스:

- [CLI Commands Guide](../ko/user-guide/cli-commands.md)

global package가 아니라 repo에서 직접 실행 중이라면:

- `bun run dev`
- `bun run start`
- `bun run restart`
- `bun run stop`
- `bun run typecheck`
- `bun run test`
- `bun run check`

## 채팅 안에서

`clisbot`은 Slack과 Telegram 안에서 thread 제어와 작업 흐름 가속을 위한 소수의 채팅 명령을 지원한다.

native coding-CLI command와의 호환성:

- `clisbot`은 자신의 reserved chat command만 가로챈다
- 그 외 Claude, Codex, Gemini의 native command text는 그대로 underlying CLI로 전달된다
- 운영 가이드: [Native CLI Commands](../ko/user-guide/native-cli-commands.md)

Slack 참고:

- Slack이 slash command를 Slack-native slash command로 처리하지 않게 하려면 앞에 공백을 넣어라
- 예: ` /bash ls -la`
- Bash shorthand인 `!ls -la`도 잘 동작한다

주요 명령:

- `/start`: 현재 대화에 맞는 onboarding 또는 route-status 도움말을 보여 준다
- `/help`: 사용 가능한 clisbot 대화 명령을 보여 준다
- `/stop`: 현재 실행 중인 turn을 중단한다
- `/streaming on`, `/streaming off`, `/streaming status`: 긴 coding 작업을 따라가고 싶을 때 실시간 진행을 켜고, 최종 답만 필요할 때 다시 끈다. Slack에서 slash command를 가로채면 ` /streaming on` 또는 `\streaming on`을 사용하라
- `/followup status`, `/followup auto`, `/followup mention-only`, `/followup pause`, `/followup resume`: bot이 자연스럽게 thread를 따라갈지, 조용히 있을지, 다시 명시적 mention을 요구할지를 제어한다. 빠른 별칭은 `/mention`, `/pause`, `/resume`이다
- `/queue <message>`: 현재 run 뒤에 다음 prompt를 걸어 두어, bot이 하나를 끝낸 뒤 자동으로 다음 일을 이어서 하게 만든다
- `/loop <schedule or count> <message>`: 하나의 지시를 반복 작업으로 바꾼다. 주기적 자동화부터 `/loop 3 계속 진행해`처럼 AI를 더 밀어붙이는 용도까지 가능하다

왜 `/queue`와 `/loop`가 중요한가:

- `/queue`는 매우 단순한 작업 흐름 기본 단위다. 지금 다음 prompt를 쌓아 두고, 이후에는 bot이 하나씩 순서대로 실행하게 한다
- `/loop`는 강한 증폭기다. 반복 review / reporting에 쓸 수도 있고, 긴 coding 작업 흐름에서 AI가 덜 게으르게, 덜 일찍 멈추게 밀어붙이는 데도 쓸 수 있다

예시:

- `/queue 계속 진행해`
- `/queue architecture와 guideline 기준으로 code review하고, 수정 후 테스트까지 진행해`
- `/loop 3 계속 진행해`

자세한 slash-command 가이드:

- [Slash Commands](../ko/user-guide/slash-commands.md)

## 문서

- [다국어 문서 개요](../README.md)
- [저장소 README 한국어판](./README.ko.md)
- [한국어 용어집](../ko/_translations/glossary.md)
- [한국어 번역 상태](../ko/_translations/status.md)
- [베트남어 저장소 README](./README.vi.md)
- [중국어 간체 저장소 README](./README.zh-CN.md)
- [프로젝트 개요](../ko/overview/README.md)
- [시스템 아키텍처](../ko/architecture/README.md)
- [아키텍처 개요](../ko/architecture/architecture-overview.md)
- [Channels 기능 문서](../ko/features/channels/README.md)
- [개발 가이드(영문 원문)](../../../docs/development/README.md)
- [기능 상태 표(영문 원문)](../../../docs/features/feature-tables.md)
- [Backlog(영문 원문)](../../../docs/tasks/backlog.md)
- [사용자 가이드](../ko/user-guide/README.md)

## 로드맵

- 더 많은 native CLI 추가. 시작은 Claude, Codex, Gemini 삼총사를 더 강하게 만드는 것부터
- 더 많은 channel 추가. Slack과 Telegram에서 시작해 이후 Zalo와 다른 확장 대화 공간으로 이동
- heartbeat, cron-style job, 더 강한 loop automation 같은 더 나은 작업 흐름 구성 요소 추가
- 실제 상태 노출이나 운영자 제어를 분명히 개선하는 곳에서 structured output, ACP, native SDK integration 탐색
- 시간이 지나며 tmux-pane capture를 넘는 더 안정적인 native messaging 경로 탐색

## 현재 초점

`clisbot`은 더 넓은 agent runtime layer로 성장하고 있다:

- Claude Code, Codex, Gemini CLI를 넘어서는 더 많은 CLI tool 지원
- Slack과 Telegram을 넘어서는 더 많은 communication channel 지원
- cron job, heartbeat job, loop 같은 단순한 작업 흐름 구성 요소
- durable agent session, workspace, follow-up policy, command, attachment, 운영자 제어가 이 모든 대화 공간에서 재사용되도록 만들기
- stability와 security는 계속 프로젝트의 최우선 초점이다. 이 두 영역에서 문제를 발견하면 꼭 알려 달라

tmux는 여전히 현재 안정성의 경계선이다. 하나의 agent는 하나의 durable runner session과 하나의 workspace에 대응되며, 모든 CLI, channel, 작업 흐름 계층은 agent를 새로 만들지 말고 그 durable runtime 위로 route되어야 한다.

## 완료된 것

- [x] 여러 Codex, Claude, Gemini session과 streaming on/off 지원
- [x] stale tmux session cleanup과 session resume
- [x] OpenClaw-compatible configuration system
- [x] streaming과 attachment를 포함한 Slack channel 지원, 그리고 smart follow mode
- [x] streaming과 attachment를 포함한 Telegram channel 지원

## AI-Native Workflow

이 repo는 작은 AI-native engineering 작업 흐름 예시이기도 하다:

- Claude / Gemini 호환 파일이 같은 원본으로 symlink될 수 있는, 단순한 `AGENTS.md` 스타일 운영 규칙
- 반복되는 피드백과 함정을 기록하는 lessons-learned 문서
- stable implementation contract로 쓰이는 architecture docs
- AI agent의 피드백 루프를 닫기 위한 end-to-end validation 기대치
- [docs/workflow/README.md](../../../docs/workflow/README.md)에 담긴 shortest-review-first 산출물 방식, 반복 review loop, task-readiness shaping workflow

## 기여하기

Merge request는 언제나 환영한다.

실제 테스트, 스크린샷, 또는 동작 녹화를 포함한 MR은 더 빨리 merge된다.
