# vibe-study

> 面向人的项目概览：这个项目是什么、给谁用、怎么跑起来。

## 这是什么

Node/TypeScript 学习实践仓库，配套一套 agent 协作规则（AGENTS.md 入职手册 + docs/ 下的架构、规范、风险登记）。
产品定位与主链路 TBD：随首个 feature 确立并回填，当前阶段以工程协作为主体。

## 快速开始

```bash
npm install   # TBD：package.json 尚未创建，首个 feature 落地后本命令可用
```

agent 视角的命令与验收见 `AGENTS.md` 的"常用命令"。

## 仓库导览

- `AGENTS.md`：AI 编码代理的入职手册。
- `docs/architecture.md`：系统设计唯一权威（§一 术语表 / §二 产品架构 / §三 逻辑架构 / §四 数据模型 / §五 代码架构 / §六 部署架构；多处登记 TBD 随首个 feature 回填）。
- `docs/before-push-checklist.md`：push 前三态检查清单。
- `docs/code-standards.md`：工程规范与反面案例。
- `docs/agent-collab-metrics.md`：人机协作度量登记口径。
- `docs/decisions/`：决策记录（格式见该目录 README；一个 PR 一篇）。
- `docs/risks/`：分域踩坑登记（格式见该目录 README）。
- `docs/archived/`：退役内容归档区（规则见该目录 README）。
