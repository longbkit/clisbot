[English](../../../migrations/index.md) | [한국어](./index.md)

# Migration Index

패키지 업데이트 시 가장 먼저 읽는 문서입니다. 수동 migration이 필요한지만 답하기 위해 존재합니다.

```text
Path: any version before 0.1.53 -> 0.1.53
Update path: direct
Manual action: none
Risk: medium
Automatic config update: yes; configs before schema `0.1.53` are backed up and rewritten to add the new admin-only sensitive channel permissions
Breaking change: no
Migration runbook: none
Read next: ../updates/update-guide.md
Release note: ../../../releases/v0.1.53.md
```

`0.1.53`은 broad internal boundary refactor release지만 수동 config 수정은 필요하지 않습니다. 업그레이드 시 기존 config가 backup되고, 현재 admin roles에는 `contactsManage`, `groupsManage`, `sensitiveChannelActionManage`가 추가됩니다.

restart 후에는 startup, route, queue, loop, enabled channels를 확인하는 것이 좋습니다. 내부 파일은 많이 이동했지만 public contract는 유지됩니다.

규칙: `Manual action: none`이라면 별도 migration runbook을 읽거나 만들어 내지 않습니다.
