[English](../../../architecture/README.md) | [Tiếng Việt](../../vi/architecture/README.md) | [简体中文](../../zh-CN/architecture/README.md) | [한국어](./README.md)

# 시스템 아키텍처

## 목적

이 문서는 `clisbot` 아키텍처 문서군으로 들어가는 한국어 진입 페이지입니다.

현재 한국어는 진입 페이지와 아키텍처 개요까지 번역되어 있습니다. 나머지 더 깊은 문서는 대응 mirror가 생길 때까지 영어 원문으로 연결됩니다.

이 영역은 다음을 이해하는 데 쓰입니다.

- 시스템 전체 구조
- channels, agents, runners, control, auth, configuration 사이의 경계
- 구현과 리뷰에서 반드시 지켜야 하는 기술 계약

## 먼저 읽을 문서

- [아키텍처 개요](./architecture-overview.md)
- [표면 아키텍처](../../../architecture/surface-architecture.md)
- [런타임 아키텍처](../../../architecture/runtime-architecture.md)
- [도메인 언어](../../../architecture/domain-language.md)

## 현재 핵심 문서

- [아키텍처 개요](./architecture-overview.md)
- [표면 아키텍처](../../../architecture/surface-architecture.md)
- [런타임 아키텍처](../../../architecture/runtime-architecture.md)
- [transcript 표현과 streaming](../../../architecture/transcript-presentation-and-streaming.md)
- [도메인 언어](../../../architecture/domain-language.md)
- [architecture design decision records](../../../architecture/decisions/README.md)
- [session key와 session id 연속성 결정](../../../architecture/decisions/2026-05-01-session-key-and-session-id-continuity-decision.md)

## 여기에 들어가야 하는 것

`docs/architecture/`는 다음과 같은 문서를 담는 곳입니다.

- 시스템 수준의 경계
- 장기적으로 유지되어야 하는 구현 제약
- routing, state, persistence, ownership 결정
- 여러 기능에 동시에 영향을 주는 공통 규칙
- 저장해 두어야 하는 저장소 전역 아키텍처 결정과 ownership-boundary 결정

## 여기에 넣지 말아야 하는 것

- backlog
- 일일 task 실행 로그
- 일회성 체크리스트
- 세부 구현 이력

이런 내용은 `docs/tasks/` 또는 `docs/features/` 쪽이 더 맞습니다.

한 feature 안에만 머무는 결정은 보통 `docs/features/<feature>/decisions/` 쪽이 더 맞습니다.
