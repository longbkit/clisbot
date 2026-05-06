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

## 잘못 배포한 버전 복구

실수로 버전을 publish했다면:

1. 먼저 올바른 target이나 tag를 publish해서 npm이 올바른 빌드를 가리키게 함
2. 그다음 잘못된 버전을 deprecate
3. `npm login`은 attached session에서 시작
4. npm이 browser approval URL을 내놓으면, 같은 session을 열린 채 유지한 뒤 승인 후 계속 진행
5. `--otp`로 우회하지 말고, 원래 browser / interactive 승인 흐름을 그대로 유지

예시:

```text
npm deprecate clisbot@0.1.46-beta.1 "Published by mistake. Use clisbot@0.1.50-beta.10 instead."
```

## 어떤 문서를 읽어야 하나

사용자가 무엇이 바뀌었는지, 무엇을 써 봐야 하는지, 무엇을 조심해야 하는지 묻는다면 다음을 읽습니다.

- [릴리스 노트](../releases/README.md)
- [v0.1.52 릴리스 노트](../../../releases/v0.1.52.md)
- [v0.1.51 릴리스 노트](../../../releases/v0.1.51.md)
- [릴리스 가이드 모음](README.md)
- [v0.1.52 릴리스 가이드](../../../updates/releases/v0.1.52-release-guide.md)
- [v0.1.51 릴리스 가이드](../../../updates/releases/v0.1.51-release-guide.md)
- [사용자 가이드](../user-guide/README.md)

버전별 기준 문서는 [릴리스 노트](../releases/README.md), 짧은 변경 요약은 [릴리스 가이드 모음](README.md)을 기준으로 봅니다.

## 현재 stable 경로

```text
Path: any version before 0.1.52 -> 0.1.52
Target: clisbot@0.1.52
Update path: direct
Manual action: none
Risk: low
Automatic config update: yes for installs before `0.1.50`; `0.1.52` adds no new schema migration but may still rewrite current-schema configs when stale short startup-delay overrides are detected
Breaking change: no
Command: npm install -g clisbot@0.1.52 && clisbot restart
검증: clisbot status
Release note: ../../../releases/v0.1.52.md
Release guide: ../../../updates/releases/v0.1.52-release-guide.md
```

이 경로에는 공개된 `0.1.43`, 그보다 오래된 legacy install, 내부 `0.1.44` pre-release install, 그리고 package bump와 stale startup-delay cleanup만 받으면 되는 `0.1.50` 또는 `0.1.51` install이 모두 포함됩니다.
