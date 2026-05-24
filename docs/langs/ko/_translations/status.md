[English](../../../../README.md) | [Tiếng Việt](../../vi/_translations/status.md) | [简体中文](../../zh-CN/_translations/status.md) | [한국어](./status.md)

# 한국어 문서 상태

- 기준 버전: `v0.1.52`
- 마지막 업데이트: `2026-05-24 UTC`
- 현재 목표: mirror tree 기준으로 실제 원본 파일을 차례대로 번역하고, 자주 읽는 문서에서 영어 원문으로 다시 떨어지는 일을 줄이는 것

## 현재 커버리지

| 그룹 | 커버리지 | 상태 |
| --- | --- | --- |
| 저장소 루트 README | `1/1` | `docs/langs/root/README.ko.md`가 루트 `README.md` 구조를 기준으로 맞춰짐 |
| Overview | `5/5` | `docs/overview/`의 `README.md`와 4개 하위 문서를 모두 번역 완료 |
| User Guide | `17/18` | 진입 페이지, 기존 user-guide 번역, `surface-access-model.md`, `zalo-bot-setup.md`, `zalo-personal.md` 번역 완료; `generic-readme.md`는 English source로 fallback |
| Features | `2/32` | 진입 페이지와 `channels/README.md`까지 번역 완료, 나머지 하위 문서는 계속 진행 필요 |
| Architecture | `2/15` | 진입 페이지와 `architecture-overview.md`까지 번역 완료, 나머지 하위 문서는 계속 진행 필요 |
| Updates | `5/5` | `docs/updates/`의 진입 페이지, update guide, release guide, template까지 번역 완료 |
| Releases | `7/7` | `docs/releases/`의 진입 페이지, 현재 release note, upcoming, template까지 번역 완료 |
| Migrations | `3/3` | `docs/migrations/`의 진입 페이지, index, template까지 번역 완료 |
| Glossary | `1/1` | 용어 기준표는 마련되었고, 이후 번역 범위에 맞춰 계속 확장 필요 |
| Status | `1/1` | 이 파일이 현재 커버리지의 사실 기준 |

## 관리 범위

- `docs/langs/root/README.ko.md`는 루트 `README.md`의 한국어 mirror입니다.
- `docs/langs/ko/_translations/glossary.md`는 한국어 문서의 통일 용어 기준입니다.
- 이 파일은 한국어 커버리지, 번역 우선순위, review 상태, 그리고 영어 원문 fallback 범위의 사실 기준입니다.

## 다음 단계

1. `generic-readme.md`는 old README backup이므로 번역 필요 여부를 별도 판단
2. `architecture/`와 `features/`의 다음 핵심 하위 문서를 이어서 번역
3. 새 번역이 늘어날 때마다 한국어 표현, 영어 누수, 로컬 링크를 다시 검토
