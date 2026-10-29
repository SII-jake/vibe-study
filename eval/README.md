# 搜索链路时延评测

> 目的：把「提问 → 联网搜索 → 读网页 → 最终回答」这条链路的时延结构与答案质量量化，
> 让每一项优化都有可比数字可依，避免凭印象判断"变快了"或"没变"。

## 用法

```bash
# 跑一次基准：6 题 × 2 轮（默认题集 eval/questions.json，默认 runner=current 即现有 runAgentTurn）
node eval/eval-search.mjs --runs 2 --tag baseline

# 对比优化方案：先在 eval/eval-search.mjs 的 RUNNERS 注册新 runner，再指定 --runner 与 --compare
node eval/eval-search.mjs --runs 2 --tag fast-guide --runner fast-guide --compare eval/reports/baseline.json
```

产物：

- 报告 JSON 落 `eval/reports/<tag>.json`（该目录不入库），含每题中位数、汇总、以及每次运行的
  逐跳明细（`events`：每次出网调用的分类/URL/响应头时延/完整时延；`steps`：agent 每步工具轨迹）。
- stdout 同步打印每题时延结构与对比表。

## 指标口径

- `totalMs`：从 runner 启动到最终回答完成的总时延。优化最终要压的就是它。
- `firstDeltaMs`：首个正文增量到达时刻。体感流畅度。
- `llmMs / llmHeaderMs`：LLM 调用的完整时延 / 响应头时延。完整时延大头是流式输出本身，
  近似与总输出字数成正比（约 27-30ms/字）；响应头时延是「排队 + 首 token 前」的近似值。
- `serperMs` / `jinaMs`：联网搜索 / 读网页工具的完整时延（含正文，正文都较短，约等于接口耗时）。
- `llmCalls` 等调用次数：区分「轮数变少」与「每跳变快」。
- 质量护栏：`contentLen`（字数）、`hasLinks`（是否带链接来源）。压时延不得以质量塌为代价。

## 跑一轮前确认

- 密钥：评测走真实链路，需 `AI_API_KEY/AI_MODEL/SERPER_KEY/JINA_KEY`（默认从 `server/.env` 读，环境变量优先）。
- 变异：LLM 与外部接口本身有抖动，正式结论建议 `--runs 3` 取中位数；小数结论只能当方向参考。
- 题集：`eval/questions.json` 是按预期行为分三类的（不该搜索/该搜索/该搜索+读来源），
  优化方法若把不该搜索的题弄去搜索了，时延对比就会虚高，这道题同时是防跑偏回归。

## 已有 runner

| 名字 | 说明 |
|---|---|
| `current` | 现状 `runAgentTurn`（基准） |

新优化方法落地时在 `eval/eval-search.mjs` 的 `RUNNERS` 表里加一行即可对比。
