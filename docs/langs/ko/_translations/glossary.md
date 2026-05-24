[English](../../../../README.md) | [Tiếng Việt](../../vi/_translations/glossary.md) | [简体中文](../../zh-CN/_translations/glossary.md) | [한국어](./glossary.md)

# 한국어 용어집

## 목적

이 문서는 `clisbot` 한국어 문서에서 반복적으로 쓰는 핵심 용어를 통일하기 위한 기준표이며, root README 한국어판과 `docs/langs/ko/` 아래 mirror 문서의 표현 기준도 함께 맡습니다.

## 관리 범위

- 이 파일은 한국어 문서 전체에서 반복되는 공용 용어 표현을 소유합니다.
- 여기서 용어를 바꾸면 `docs/langs/root/README.ko.md`와 이미 존재하는 한국어 mirror / 진입 문서도 함께 맞춰야 합니다.

## 우선 용어 매핑

| English | 한국어 우선 표현 | 메모 |
| --- | --- | --- |
| agent | agent / 에이전트 | 기술 독자에게는 `agent`도 자연스럽습니다. |
| bot | bot / 봇 | |
| workspace | workspace / 작업 공간 | CLI 문맥에서는 `workspace` 유지 가능 |
| queue | queue / 대기열 | 명령어 문맥에서는 `queue` 유지 |
| loop | loop / 반복 작업 | `/loop`는 그대로 유지 |
| route | route / 라우트 | CLI/config 문맥에서는 `route`가 더 자연스러움 |
| routing | 라우팅 | 시스템 흐름 설명에서는 “라우팅” 사용 |
| pairing | pairing / 초기 연결 승인 | |
| follow-up | 후속 응답 흐름 | 너무 직역하지 않기 |
| streaming | streaming / 실시간 출력 | |
| response mode | response mode | config / command 문맥에서는 원문 유지 |
| additional message mode | additional-message-mode | config / command 문맥에서는 원문 유지 |
| allowlist | allowlist / 허용 목록 | CLI / config 문맥에서는 `allowlist` 유지 |
| render | render | `message` command contract 문맥에서는 원문 유지 |
| runtime | runtime / 실행 런타임 | |
| session | session / 세션 | |
| sessionId | `sessionId` | 번역하지 않음 |
| topic | topic | Telegram 문맥에서는 그대로 유지 |
| thread | thread | Slack 문맥에서는 그대로 유지 |
| assistant | 어시스턴트 / assistant | 일반 문장에서는 “어시스턴트”, 제품 포지셔닝에 가까울 때는 `assistant` 유지 가능 |
| AI-native | AI-native | repo 전반에서 쓰는 핵심 방향 용어라 그대로 유지 |
| chat-native | 채팅 안에서 바로 쓰는 경험 | 일반 문장에서는 이 표현을 우선 |
| surface | 대화 공간 / 채팅 맥락 | 제품 설명에서는 “대화 공간”, 발신자 문맥 설명에서는 “채팅 맥락” 우선 |
| release notes | 릴리스 노트 | |
| update guide | 업데이트 가이드 | |
| migration | 마이그레이션 | |
| owner | owner / 소유자 역할 | role 이름은 원문 유지 가능 |
| admin | admin / 관리자 역할 | |
| operator | 운영자 | 일반 문장에서는 “운영자” 우선 |
| prompt | prompt | 제품 문서에서 무리한 순화 번역 지양 |
| control plane | control plane / 제어 평면 | |
| workflow | 작업 흐름 / 워크플로 | 일반 문장에서는 “작업 흐름”을 우선 |
| OpenClaw / Hermes Agent | OpenClaw / Hermes Agent | 외부 project/product 이름은 유지 |
| Zalo Bot | Zalo Bot | channel 이름은 유지 |
| Zalo Personal | Zalo Personal | 이름 유지; main positioning에서는 alpha라고 부르지 않음 |
| auto-skill | auto-skill / skill 자동 생성과 개선 | Hermes-style skill evolution 문맥에서 사용 |
| channel surface | channel surface / 채널 대화 공간 | 독자용 문장에서는 “채널 대화 공간”도 사용 |

## 사용 규칙

- 한국어 독자가 자연스럽게 읽을 수 있는 표현을 우선합니다.
- 영어는 제품 고유 명칭, 명령어, 설정 키, 업계에서 이미 굳은 표현일 때만 유지합니다.
- 반복 용어를 수정할 때는 먼저 이 파일을 고친 뒤 한국어 root README와 다른 한국어 문서에 반영합니다.
