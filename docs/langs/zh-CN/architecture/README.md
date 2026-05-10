[English](../../../architecture/README.md) | [Tiếng Việt](../../vi/architecture/README.md) | [简体中文](./README.md) | [한국어](../../ko/architecture/README.md)

# 系统架构

## 目的

这是 `clisbot` 架构文档的中文入口页。

当前中文只完成了这一页入口。架构子文档仍先回退到英文原文。

这一组文档主要帮助你理解：

- 系统整体形状
- channels、agents、runners、control、auth、configuration 之间的边界
- 实现和 review 时必须遵守的技术契约

## 推荐先读

- [Architecture Overview（英文原文）](../../../architecture/architecture-overview.md)
- [对话场景架构（英文原文）](../../../architecture/surface-architecture.md)
- [Runtime Architecture（英文原文）](../../../architecture/runtime-architecture.md)
- [Domain Language（英文原文）](../../../architecture/domain-language.md)

## 当前核心文档

- [Architecture Overview](../../../architecture/architecture-overview.md)
- [对话场景架构](../../../architecture/surface-architecture.md)
- [Runtime Architecture](../../../architecture/runtime-architecture.md)
- [Transcript Presentation And Streaming](../../../architecture/transcript-presentation-and-streaming.md)
- [Domain Language](../../../architecture/domain-language.md)
- [Architecture Design Decisions](../../../architecture/decisions/README.md)
- [Session Key And Session Id Continuity Decision](../../../architecture/decisions/2026-05-01-session-key-and-session-id-continuity-decision.md)

## 这里应该放什么

`docs/architecture/` 适合放：

- 系统级边界
- 长期稳定的实现约束
- 路由、状态、持久化、归属边界相关决策
- 会影响多个功能区的共通规则
- 需要长期保留的仓库级架构决策与 ownership boundary 决策

## 不应该放什么

这里不适合放：

- backlog
- 日常 task 执行记录
- 一次性的交付清单
- 具体交付历史

这些更应该放在 `docs/tasks/` 或 `docs/features/`。

如果决策只属于单个 feature，通常应该放在 `docs/features/<feature>/decisions/`。
