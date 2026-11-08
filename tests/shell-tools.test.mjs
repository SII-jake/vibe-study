/**
 * bash/python 工具测试。
 *
 * 用独立 node 子进程跑：vitest 会强制注入 jsdom，而 jsdom 尚未实现
 * TextEncoderStream（Node 22 原生有）——child_process 的流式 stdout 采集依赖它。
 * 因此本文件不进 vitest 进程，由 `npm test` 先以 plain node 运行。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeTool } from '../server/tools.mjs'

const TOOL_CONFIG = { shellTools: true }

test('run_bash：返回 stdout、stderr 与退出码', async () => {
  const out = await executeTool(TOOL_CONFIG, 'run_bash', { command: 'echo hello' })
  assert.match(out, /hello/)
  assert.match(out, /退出码.*0/)
})

test('run_bash：非零退出码不抛错，结果文本如实体现在 tool 结果里', async () => {
  const out = await executeTool(TOOL_CONFIG, 'run_bash', { command: 'echo boom >&2; exit 3' })
  assert.match(out, /boom/)
  assert.match(out, /退出码.*3/)
})

test('run_python：直接执行代码并回传打印输出', async () => {
  const out = await executeTool(TOOL_CONFIG, 'run_python', { code: 'print(6 * 7)' })
  assert.match(out, /42/)
  assert.match(out, /退出码.*0/)
})

test('run_python：脚本语法错误同样以文本回传而不是抛异常', async () => {
  const out = await executeTool(TOOL_CONFIG, 'run_python', { code: 'this is not python' })
  assert.match(out, /退出码.*[^0]/)
})

test('单个 shell 调用受超时上限约束，不能无限挂住', async () => {
  const started = Date.now()
  const out = await executeTool(TOOL_CONFIG, 'run_bash', { command: 'sleep 30' }, fetch, { timeoutMs: 200 })
  assert.ok(Date.now() - started < 5000, `应在 ~1s 内返回，实际 ${Date.now() - started}ms`)
  assert.match(out, /超时/)
})

test('超时杀手进程组：shell 拉起的孙子进程不能变成孤儿留在服务器上', async () => {
  // 唯一标记串：若在 ps 输出里残留，就说明同组孙子进程没被组杀。
  // 非交互 sh 不带 job control，后台 job 与 sh 同一进程组，组杀必须把它带走。
  const out = await executeTool(
    TOOL_CONFIG,
    'run_bash',
    { command: 'sleep 10777 & sleep 30' },
    fetch,
    { timeoutMs: 200 },
  )
  assert.match(out, /超时/)
  const { execFileSync } = await import('node:child_process')
  const ps = execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' })
  assert.ok(!ps.includes('sleep 10777'), `孙子进程未被组杀:\n${ps}`)
})

test('未启用 shell 工具时，工具调用以未启用文本回给模型', async () => {
  const out = await executeTool({ shellTools: false }, 'run_bash', { command: 'echo hi' })
  assert.match(out, /未启用|未配置/)
})

test('缺 command / code 参数时不至于起子进程', async () => {
  const out = await executeTool(TOOL_CONFIG, 'run_bash', {})
  assert.match(out, /command|参数/)
  const outPy = await executeTool(TOOL_CONFIG, 'run_python', {})
  assert.match(outPy, /code|参数/)
})
