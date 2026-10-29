#!/usr/bin/env node
/**
 * 搜索链路时延评测 CLI。
 *
 * 用法：
 *   node eval/eval-search.mjs --runs 3 --tag baseline          # 跑一轮并产出报告 JSON + 可读表格
 *   node eval/eval-search.mjs --runs 3 --tag opt --compare eval/reports/baseline.json   # 与基准按题对比
 *
 * 报告 JSON 与可读表格同时输出：JSON 落 eval/reports/<tag>.json（缺省按时间戳起名），
 * 供 --compare 反复引用；表格打到 stdout 供直接读。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadServerConfig, withEnvSource } from '../server/config.mjs'
import { runAgentTurn } from '../server/agent.mjs'
import { aggregateRuns, compareReports, runQuestion } from './framework.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** 可选的 runner 注册表：每个优化方法一个名字，--runner 按名取。 */
const RUNNERS = {
  current: runAgentTurn,
}

export function parseArgs(argv) {
  const args = argv.slice(2)
  const options = {
    runs: 1,
    tag: '',
    runner: 'current',
    questionsPath: join(here, 'questions.json'),
    comparePath: null,
  }
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    const value = args[index + 1]
    if (flag === '--runs') {
      const parsed = Number(value)
      options.runs = Number.isInteger(parsed) && parsed > 0 ? parsed : 1
      index += 1
    } else if (flag === '--tag') {
      options.tag = String(value ?? '')
      index += 1
    } else if (flag === '--runner') {
      options.runner = String(value ?? 'current')
      index += 1
    } else if (flag === '--questions') {
      options.questionsPath = String(value ?? options.questionsPath)
      index += 1
    } else if (flag === '--compare') {
      options.comparePath = String(value ?? '')
      index += 1
    }
  }
  return options
}

const KNOWN_TOOL_USE = new Set(['none', 'search', 'search+read'])

/** 问题集文件读进来先过一道校验，缺字段在这里报读得懂的错，不让 undefined 混进报告。 */
export function validateQuestions(raw) {
  if (!Array.isArray(raw)) throw new Error('问题集文件必须是题目数组')
  if (raw.length === 0) throw new Error('问题集至少一道题')
  raw.forEach((question, index) => {
    if (typeof question?.id !== 'string' || question.id === '') {
      throw new Error(`第 ${index + 1} 题缺 id 字符串`)
    }
    if (!KNOWN_TOOL_USE.has(question.expectedToolUse)) {
      throw new Error(`题 ${question.id} 的 expectedToolUse 必须是 none / search / search+read 之一`)
    }
    if (typeof question.text !== 'string' || question.text === '') {
      throw new Error(`题 ${question.id} 缺 text`)
    }
  })
  return raw
}

function formatMs(value) {
  return value === null ? '  ——  ' : `${Math.round(value)}ms`
}

function formatDeltaPct(value) {
  return value === null ? '  ——' : `${value > 0 ? '+' : ''}${value}%`
}

/** 把一份评测报告打成可读表格（无对比时基准即自身）。 */
export function formatComparison(comparison) {
  const lines = []
  lines.push(`题号 | 基准 ${comparison.baseline} | 候选 ${comparison.candidate} | 差值 | 百分比`)
  lines.push('---|---|---|---|---')
  for (const row of comparison.rows) {
    const delta = row.deltaMs === null ? `${formatMs(row.candMs)}（缺题）` : `${formatMs(row.deltaMs)}`
    lines.push(
      `${row.id} | ${formatMs(row.baseMs)} | ${formatMs(row.candMs)} | ${delta} | ${formatDeltaPct(row.deltaPct)}`,
    )
  }
  lines.push(
    `汇总 | ${formatMs(comparison.summary.baseMs)} | ${formatMs(comparison.summary.candMs)} | ` +
      `${formatMs(comparison.summary.deltaMs)} | ${formatDeltaPct(comparison.summary.deltaPct)}`,
  )
  return lines.join('\n')
}

/** 打印一题的时延结构明细，慢在哪一跳一眼能看出来。 */
function formatQuestionDetail(question) {
  const median = question.median
  return (
    `${question.id}: 总 ${Math.round(median.totalMs)}ms` +
    `（首增量 ${median.firstDeltaMs === null ? '无' : `${Math.round(median.firstDeltaMs)}ms`}，` +
    `LLM ${median.llmCalls} 次共 ${Math.round(median.llmMs)}ms（响应头 ${Math.round(median.llmHeaderMs)}ms），` +
    `搜索 ${median.serperCalls} 次共 ${Math.round(median.serperMs)}ms，` +
    `读页 ${median.jinaCalls} 次共 ${Math.round(median.jinaMs)}ms）`
  )
}

async function main() {
  const options = parseArgs(process.argv)
  const runner = RUNNERS[options.runner]
  if (!runner) {
    console.error(`未知 runner：${options.runner}（可用：${Object.keys(RUNNERS).join(', ')}）`)
    process.exit(1)
  }

  const questionsPath = resolve(options.questionsPath)
  const questions = validateQuestions(JSON.parse(readFileSync(questionsPath, 'utf8')))
  const config = loadServerConfig(withEnvSource(process.env, () => readFileSync(join(here, '../server/.env'), 'utf8')))
  if (config.apiKey === '' || config.model === '') {
    console.error('未配置 AI_API_KEY / AI_MODEL，评测需要真实链路的密钥（server/.env 或环境变量）。')
    process.exit(1)
  }

  const tag = options.tag === '' ? `run-${new Date().toISOString().replace(/[:.]/g, '-')}` : options.tag
  console.error(`[eval] 开始评测：${questions.length} 题 × ${options.runs} 轮，runner=${options.runner}，tag=${tag}`)

  const questionReports = []
  for (const question of questions) {
    const runs = []
    for (let round = 0; round < options.runs; round += 1) {
      console.error(`[eval] ${question.id} 第 ${round + 1}/${options.runs} 轮…`)
      const metrics = await runQuestion({ runner, config, question })
      runs.push(metrics)
      console.error(
        `[eval]   总 ${Math.round(metrics.totalMs)}ms，LLM ${metrics.llmCalls} 次，搜索 ${metrics.serperCalls} 次，读页 ${metrics.jinaCalls} 次` +
          (metrics.error ? `（失败：${metrics.error}）` : ''),
      )
    }
    questionReports.push({ id: question.id, expectedToolUse: question.expectedToolUse, runs })
  }

  const report = aggregateRuns({
    questions: questionReports,
    meta: { tag, runner: options.runner, runsPerQuestion: options.runs, config: { model: config.model, baseUrl: config.baseUrl } },
  })

  const reportsDir = join(here, 'reports')
  mkdirSync(reportsDir, { recursive: true })
  const reportPath = join(reportsDir, `${tag}.json`)
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.error(`[eval] 报告已写入 ${reportPath}`)

  console.log('\n== 每题时延结构（中位数） ==')
  for (const question of report.questions) {
    console.log(formatQuestionDetail(question))
    for (const error of question.errors) console.log(`  ⚠ 失败：${error}`)
  }

  if (options.comparePath) {
    const baseline = JSON.parse(readFileSync(resolve(options.comparePath), 'utf8'))
    console.log(`\n== 与基准 ${baseline.meta?.tag ?? options.comparePath} 对比 ==`)
    console.log(formatComparison(compareReports(baseline, report)))
  } else {
    console.log(`\n汇总：${report.summary.questionCount} 题的中位总时延 ${Math.round(report.summary.medianTotalMs)}ms` +
      (report.summary.totalErrors > 0 ? `，失败 ${report.summary.totalErrors} 次` : ''))
  }
}

// 直接当脚本跑时执行 main；被测试 import 时不触发。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((cause) => {
    console.error(`[eval] 评测失败：${cause?.stack ?? cause}`)
    process.exit(1)
  })
}
