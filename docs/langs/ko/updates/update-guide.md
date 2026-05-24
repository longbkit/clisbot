[English](../../../updates/update-guide.md) | [한국어](./update-guide.md)

# clisbot 업데이트 가이드

먼저 [마이그레이션 인덱스](../migrations/index.md)에서 수동 조치가 필요한지 확인한 뒤 이 문서를 봅니다.

현재 `clisbot update`와 `clisbot update --help`는 가이드를 출력만 하며, 패키지를 직접 설치하지는 않습니다.
bot도 이 가이드를 따라 자기 자신을 업데이트할 수 있습니다.

## 결정 규칙

```text
stable/latest/default -> npm dist-tag latest
beta                  -> npm dist-tag beta
exact version         -> 사용자가 지정한 버전
manual action default -> none
```

항상 가장 높은 semver가 아니라 npm dist-tag를 기준으로 사용합니다. beta는 사용자가 요청한 경우에만 씁니다.

## 흐름

```text
clisbot status
npm install -g clisbot@<target> && clisbot restart
clisbot status
버전, health, manual action, 유용한 release highlight 보고
```

## 범위

이 가이드는 install/update 전용입니다. release, publish, deprecate workflow는
이 문서의 범위가 아니며, 해당 작업에는 repo release workflow를 사용합니다.

## 어떤 문서를 읽어야 하나

사용자가 무엇이 바뀌었는지, 무엇을 써 봐야 하는지, 무엇을 조심해야 하는지 묻는다면 다음을 읽습니다.

- [릴리스 노트](../releases/README.md)
- [v0.1.53 릴리스 노트](../../../releases/v0.1.53.md)
- [v0.1.52 릴리스 노트](../../../releases/v0.1.52.md)
- [v0.1.51 릴리스 노트](../../../releases/v0.1.51.md)
- [릴리스 가이드 모음](README.md)
- [v0.1.53 릴리스 가이드](../../../updates/releases/v0.1.53-release-guide.md)
- [v0.1.52 릴리스 가이드](../../../updates/releases/v0.1.52-release-guide.md)
- [v0.1.51 릴리스 가이드](../../../updates/releases/v0.1.51-release-guide.md)
- [사용자 가이드](../user-guide/README.md)

버전별 기준 문서는 [릴리스 노트](../releases/README.md), 짧은 변경 요약은 [릴리스 가이드 모음](README.md)을 기준으로 봅니다.

## 현재 stable 경로

```text
Path: any version before 0.1.53 -> 0.1.53
Target: clisbot@0.1.53
Update path: direct
Manual action: none
Risk: medium
Automatic config update: yes; configs before schema `0.1.53` are backed up and rewritten to add the new admin-only sensitive channel permissions
Breaking change: no
Command: npm install -g clisbot@0.1.53 && clisbot restart
검증: clisbot status
Release note: ../../../releases/v0.1.53.md
Release guide: ../../../updates/releases/v0.1.53-release-guide.md
```

이 경로에는 공개된 `0.1.43`, 그보다 오래된 legacy install, 내부 `0.1.44` pre-release install, 그리고 `0.1.50`, `0.1.51`, `0.1.52` install이 모두 포함됩니다.
