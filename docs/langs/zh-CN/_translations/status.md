[English](../../../../README.md) | [Tiếng Việt](../../vi/_translations/status.md) | [简体中文](./status.md) | [한국어](../../ko/_translations/status.md)

# 简体中文文档状态

- 基线版本：`v0.1.52`
- 最后更新：`2026-05-24 UTC`
- 当前目标：严格按 mirror tree 补齐真实源文件，并尽量减少常读页面再次跳回英文。

## 当前覆盖情况

| 分组 | 覆盖率 | 状态 |
| --- | --- | --- |
| 仓库根 README | `1/1` | `docs/langs/root/README.zh-CN.md` 已按根 `README.md` 的真实结构完成镜像 |
| Overview | `4/5` | 已补齐除 `human-requirements.md` 之外的常读子页面 |
| User Guide | `4/18` | 已有入口页、`surface-access-model.md`、`zalo-bot-setup.md`、`zalo-personal.md`；其他子文档仍明确回退到英文原文 |
| Features | `1/32` | 目前只有入口页，子文档仍待补齐 |
| Architecture | `1/15` | 目前只有入口页，子文档仍待补齐 |
| Updates | `1/5` | 目前只有入口页，子文档仍待补齐 |
| Releases | `1/7` | 目前只有入口页，子文档仍待补齐 |
| Migrations | `1/3` | 目前只有入口页，子文档仍待补齐 |
| Glossary | `1/1` | 术语表已建立，后续需随着翻译覆盖扩展 |
| Status | `1/1` | 本文件是当前覆盖情况的真实来源 |

## 负责范围

- `docs/langs/root/README.zh-CN.md` 是 root `README.md` 的中文镜像。
- `docs/langs/zh-CN/_translations/glossary.md` 负责中文文档的统一术语。
- 本文件负责中文覆盖率、翻译优先级、review 状态，以及哪些位置仍然明确回退到英文原文的真实记录。

## 后续重点

1. 继续补 `user-guide/` 全量子文档，优先 runtime operations、auth/routes、CLI commands
2. 再补 `updates/` 与 `releases/`
3. 然后补 `features/`、`architecture/`、`migrations/`
4. 每个批次之后做中文语感与 glossary 同步复查
