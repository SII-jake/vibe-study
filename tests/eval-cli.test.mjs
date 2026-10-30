import { describe, expect, it } from 'vitest'
import { parseArgs, formatComparison, validateQuestions } from '../eval/eval-search.mjs'

describe('parseArgs', () => {
  it('默认值：一轮、当前 runAgentTurn runner、报告落 eval/reports/', () => {
    const args = parseArgs(['node', 'eval-search.mjs'])
    expect(args.runs).toBe(1)
    expect(args.runner).toBe('current')
    expect(args.comparePath).toBeNull()
    expect(args.questionsPath).toContain('questions.json')
    expect(args.tag).toBe('')
  })

  it('认 --runs / --tag / --runner / --questions / --compare 五个参数', () => {
    const args = parseArgs([
      'node', 'eval-search.mjs',
      '--runs', '3',
      '--tag', 'baseline',
      '--runner', 'parallel-search',
      '--questions', 'my-questions.json',
      '--compare', 'eval/reports/base.json',
    ])
    expect(args.runs).toBe(3)
    expect(args.tag).toBe('baseline')
    expect(args.runner).toBe('parallel-search')
    expect(args.questionsPath).toBe('my-questions.json')
    expect(args.comparePath).toBe('eval/reports/base.json')
  })

  it('runs 是非法数字时落到 1', () => {
    expect(parseArgs(['node', 'e', '--runs', 'abc']).runs).toBe(1)
  })
})

describe('validateQuestions', () => {
  it('合法问题集原样通过', () => {
    const questions = [{ id: 'q1', expectedToolUse: 'search', text: 'x', note: '' }]
    expect(validateQuestions(questions)).toEqual(questions)
  })

  it('空数组或非数组报可读错误', () => {
    expect(() => validateQuestions([])).toThrow(/至少一道/)
    expect(() => validateQuestions('nope')).toThrow(/题目数组/)
  })

  it('字段缺失或 expectedToolUse 非法时报读得懂的错误', () => {
    expect(() => validateQuestions([{ id: 'q1', text: 'x' }])).toThrow(/expectedToolUse/)
    expect(() => validateQuestions([{ id: 'q1', expectedToolUse: 'maybe', text: 'x' }])).toThrow(/expectedToolUse/)
  })
})

describe('formatComparison', () => {
  const comparison = {
    baseline: 'base',
    candidate: 'cand',
    summary: { baseMs: 2000, candMs: 1300, deltaMs: -700, deltaPct: -35 },
    rows: [
      {
        id: 'q1',
        expectedToolUse: 'search',
        baseMs: 2000,
        candMs: 1300,
        deltaMs: -700,
        deltaPct: -35,
        baseMedian: { llmCalls: 3, serperCalls: 1, serperMs: 2000, serperWallMs: 2100, jinaCalls: 1, jinaMs: 6000, jinaWallMs: 6200, firstDeltaMs: 900, contentLen: 800 },
        candMedian: { llmCalls: 2, serperCalls: 2, serperMs: 5000, serperWallMs: 2600, jinaCalls: 0, jinaMs: 0, jinaWallMs: 0, firstDeltaMs: 700, contentLen: 750 },
      },
    ],
  }

  it('输出含题级行与汇总行的可读对比表', () => {
    const text = formatComparison(comparison)
    expect(text).toContain('q1')
    expect(text).toContain('2000ms')
    expect(text).toContain('1300ms')
    expect(text).toContain('-700ms')
    expect(text).toContain('-35%')
    expect(text).toContain('汇总')
  })

  it('search 与 fetch 分别给出两侧次数/总耗时/壁钟，不和打包总时延混在一起', () => {
    const text = formatComparison(comparison)
    // 基准侧：search 1 次共 2.0s（壁钟 2.1s）；fetch 1 页共 6.0s（壁钟 6.2s）
    expect(text).toMatch(/搜索.*1 次/)
    expect(text).toMatch(/搜索.*2\.0s/)
    expect(text).toMatch(/搜索.*2\.1s/)
    expect(text).toMatch(/抓取.*1 页.*6\.0s/)
    // 候选侧：search 2 次共 5.0s；fetch 0 页
    expect(text).toMatch(/搜索.*2 次.*5\.0s/)
    expect(text).toMatch(/抓取.*0 页/)
  })

  it('候选缺题时该行明确标出而不是裸 null', () => {
    const missing = {
      ...comparison,
      rows: [{ ...comparison.rows[0], candMs: null, deltaMs: null, deltaPct: null, candMedian: null }],
    }
    const text = formatComparison(missing)
    expect(text).toContain('缺题')
  })
})
