import type { LearnNode } from '../domain/tree'

/** 内置示例树：不配置模型也能完整体验锚点式追问，随时可整棵删除。 */
const ROOT_ANSWER = [
  '## 复利是什么',
  '',
  '复利是指把每一期产生的利息计入本金，下一期按新的本金继续计息。利息本身也产生利息，这是它与单利的根本区别。',
  '',
  '- 单利：每期只对本金计息，利息不滚入本金。',
  '- 复利：每期把利息滚入本金，计息基数逐期变大。',
  '',
  '用公式表达，本金 P、每期利率 r、经过 n 期后：',
  '',
  '```',
  '单利：F = P × (1 + r × n)',
  '复利：F = P × (1 + r)^n',
  '```',
  '',
  '> 时间是复利最重要的变量，而不是收益率。',
  '',
  '举个具体例子：本金 1 万元，年化 10%，30 年后单利约为 4 万元，复利约为 17.4 万元。',
].join('\n')

const RATE_ANSWER = [
  '两者在数学上只差一个指数位置。',
  '',
  '单利是线性函数，随 n 线性增长；复利是幂函数，随 n 指数增长。',
  '',
  '在 r 很小的近似下，(1 + r)^n ≈ 1 + r × n，所以短期看不出差别；期数一多，幂函数就拉开了距离。',
].join('\n')

const LONG_TERM_ANSWER = [
  '是的，期数的影响通常大于收益率。',
  '',
  '因为收益率进入底数、期数进入指数，指数增长对期数的敏感度更高。',
  '',
  '把 1 万元按年化 7% 分别放 20 年和 40 年：前者约 3.87 万元，后者约 14.97 万元。多一倍时间，结果接近四倍。',
].join('\n')

const EXP_ANSWER = [
  '年化收益率 r 与连续复利收益率 R 的关系是 R = ln(1 + r)。',
  '',
  '年化 10% 对应连续复利约 9.53%。',
  '',
  '连续复利的好处是可加：两段连续复利收益直接相加，而普通年化收益率要做乘除。',
].join('\n')

export function createDemoNodes(now: number): LearnNode[] {
  return [
    {
      id: 'demo-root',
      parentId: null,
      anchor: null,
      createdAt: now,
      messages: [
        { id: 'demo-root-m0', role: 'user', content: '什么是复利？', createdAt: now },
        { id: 'demo-root-m1', role: 'assistant', content: ROOT_ANSWER, createdAt: now },
      ],
    },
    {
      id: 'demo-rate',
      parentId: 'demo-root',
      anchor: {
        messageId: 'demo-root-m1',
        fragmentIndex: 1,
        text: '利息本身也产生利息，这是它与单利的根本区别',
      },
      createdAt: now + 1,
      messages: [
        { id: 'demo-rate-m0', role: 'user', content: '那和单利的差别在数学上怎么描述？', createdAt: now + 1 },
        { id: 'demo-rate-m1', role: 'assistant', content: RATE_ANSWER, createdAt: now + 1 },
      ],
    },
    {
      id: 'demo-time',
      parentId: 'demo-root',
      anchor: { messageId: 'demo-root-m1', fragmentIndex: 1, text: '利息本身也产生利息' },
      createdAt: now + 2,
      messages: [
        { id: 'demo-time-m0', role: 'user', content: '长期看，时间的影响比收益率更大吗？', createdAt: now + 2 },
        { id: 'demo-time-m1', role: 'assistant', content: LONG_TERM_ANSWER, createdAt: now + 2 },
      ],
    },
    {
      id: 'demo-exp',
      parentId: 'demo-rate',
      anchor: { messageId: 'demo-rate-m1', fragmentIndex: 2, text: '(1 + r)^n ≈ 1 + r × n' },
      createdAt: now + 3,
      messages: [
        { id: 'demo-exp-m0', role: 'user', content: '年化收益率怎么换算成连续复利？', createdAt: now + 3 },
        { id: 'demo-exp-m1', role: 'assistant', content: EXP_ANSWER, createdAt: now + 3 },
      ],
    },
  ]
}
