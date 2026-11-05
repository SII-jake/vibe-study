# 搜索链路时延评测

> 目的：把「提问 → 联网搜索 → 读网页 → 最终回答」这条链路的时延结构与答案质量量化，
> 让每一项优化都有可比数字可依，避免凭印象判断"变快了"或"没变"。

## 用法

```bash
# 跑一次基准：6 题 × 2 轮（默认题集 eval/questions.json，默认 runner=current 即现有 runAgentTurn）
node eval/eval-search.mjs --runs 2 --tag baseline

# 对比优化方案：先在 eval/eval-search.mjs 的 RUNNERS 注册新 runner，再指定 --runner 与 --compare
node eval/eval-search.mjs --runs 2 --tag fast-guide --runner fast-guide --compare eval/reports/baseline.json

# 只检索不抓正文（DeepSeek summary 路线，实测最优组合）
node eval/eval-search.mjs --runs 2 --tag ds-nofetch --fetch-pages 0 --compare eval/reports/capped.json

# serper snippet 公平对照（临时屏蔽 DEEPSEEK_KEY）
DEEPSEEK_KEY= node eval/eval-search.mjs --runs 2 --tag serper-nofetch --fetch-pages 0 --compare eval/reports/capped.json
```

产物：

- 报告 JSON 落 `eval/reports/<tag>.json`（该目录不入库），含每题中位数、汇总、以及每次运行的
  逐跳明细（`events`：每次出网调用的分类/URL/响应头时延/完整时延；`steps`：agent 每步工具轨迹）、
  以及回答全文 `content`（跨方案质量对比的原料）。
- stdout 同步打印每题时延结构与对比表（题下附 search/fetch 分项）。

## 指标口径

- `totalMs`：从 runner 启动到最终回答完成的总时延。优化最终要压的就是它。
- `firstDeltaMs`：首个正文增量到达时刻。体感流畅度。
- `llmMs / llmHeaderMs`：LLM 调用的完整时延 / 响应头时延。完整时延大头是流式输出本身，
  近似与总输出字数成正比（约 27-30ms/字）；响应头时延是「排队 + 首 token 前」的近似值。
- `searchMs` / `fetchMs`：搜索（检索）与抓取（读正文）两个阶段的完整时延。
  分类按「阶段」命名而不是按提供方（serper 与 DeepSeek tools/search 都归 `search`，
  jina 与 DeepSeek tools/fetch 都归 `fetch`），换提供方时评测代码与报告口径不变；
  旧报告（改名前生成）对比时标注「无法拆分」而不是输出 NaN。
- `llmCalls` 等调用次数：区分「轮数变少」与「每跳变快」。
- 质量护栏：`contentLen`（字数）、`hasLinks`（是否带链接来源）、`content`（回答全文，
  供人工逐题核验事实与引用）。压时延不得以质量塌为代价。

## 参数

| 参数 | 说明 |
|---|---|
| `--runs N` | 每题跑几轮取中位数（正式结论建议 3） |
| `--tag X` | 报告落 `eval/reports/X.json` |
| `--fetch-pages N` | 覆盖单次 search 抓正文页数上限（0 = 只检索不抓正文） |
| `--runner X` | agent 实现；提供方切换不走 runner，由 `DEEPSEEK_KEY` 是否配置决定 |
| `--questions PATH` | 自定义题集 |
| `--compare PATH` | 对比基准报告 |

## 跑一轮前确认

- 密钥：评测走真实链路，需 `AI_API_KEY/AI_MODEL/SERPER_KEY/JINA_KEY`（默认从 `server/.env` 读，环境变量优先）；
  切 DeepSeek 提供方需配 `DEEPSEEK_KEY`（直连 api.deepseek.com，不走 mas 网关）。
- 变异：LLM 与外部接口本身有抖动，正式结论建议 `--runs 3` 取中位数；小数结论只能当方向参考。
- 题集：`eval/questions.json` 是按预期行为分三类的（不该搜索/该搜索/该搜索+读来源），
  优化方法若把不该搜索的题弄去搜索了，时延对比就会虚高，这道题同时是防跑偏回归。

## 当前实测结论（详见 docs/decisions/2026-10-29-eval-search-latency.md）

相对原始基线 117.9s 的优化路径：

1. 打包 search + 收口（当前线上行为，capped）：33.1s（-72%）
2. DeepSeek 只吃 summary 不抓正文（ds-nofetch）：22.5-26.5s，质量人工核验不降
3. DeepSeek 抓正文：42.6s（冷页慢于 jina 2-10 倍、学习场景缓存命中率≈0，不采纳）

## 已有 runner

| 名字 | 说明 |
|---|---|
| `current` | 现状 `runAgentTurn`（基准） |

新优化方法落地时在 `eval/eval-search.mjs` 的 `RUNNERS` 表里加一行即可对比。
