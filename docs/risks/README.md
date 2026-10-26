# 分域踩坑登记的格式约定

本目录按领域记技术坑，一域一个文件（如 `backend-risks.md`、`frontend-risks.md`、`infra-risks.md`）；用不到的域直接删掉对应文件。

## 什么进这里

- 技术层面的坑：库用法踩雷、平台行为反直觉、环境差异导致的故障——以后换个 agent 换个人重踩一次的那种。
- 协作过程的坑（规格不清、静默跳过、带病开工）不进本目录，登记到 `docs/agent-collab-metrics.md`。

## 记录规则

- 新条目加在所属域文件的**最上方**（新坑先看）。
- 每条写清三件事：症状（当时看到什么）、根因（为什么会这样）、做法（下次怎么提前拦住）。
- 条目用语规范：一完整句一行、无营销词、术语照抄 architecture.md。
- 坑若暴露的是反复发生的问题，把对应防线提升到 `docs/before-push-checklist.md` 第四节的分域检查项里。
- 防线已稳的条目退役到 `docs/archived/`，规则见其 README；清单正文只留一行指针。

## 条目的退役

某条坑的防线已稳后，条目移入 `docs/archived/` 对应域文件，不再随本清单进入每次任务 context；退役规则见 `docs/archived/README.md`。
