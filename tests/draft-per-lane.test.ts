// 草稿按 lane 分键（用户 2026-11-25 报的网页版 bug）：右栏输入时中栏输入框
// 同步显示同样内容。根因是草稿只按 sessionId 分键——中栏与右栏同属一个会话，
// 两个受控 textarea 读的是同一份草稿。
import { beforeEach, describe, expect, it, vi } from 'vitest'

// drafts 经 attachments 引入 api/client，后者读 rspack DefinePlugin 注入的
// __API_ORIGIN__——测试环境没有这个全局，桩掉客户端模块。
vi.mock('../web/src/services/api/client.js', () => ({
  API_ORIGIN: 'http://test',
  uploadFile: vi.fn(async () => ({ id: 'f1' })),
  deleteFile: vi.fn(async () => {}),
  ApiError: class ApiError extends Error {},
}))

import {
  clearAllDrafts,
  clearDraft,
  clearSentDraft,
  draftKeyOf,
  getDraft,
  setDraftText,
} from '../web/src/services/chat/drafts.js'

describe('draftKeyOf（草稿分键）', () => {
  it('新对话恒用 null 键（与旧口径一致）', () => {
    expect(draftKeyOf(null, null)).toBe(null)
    expect(draftKeyOf(null, 'q1')).toBe(null)
  })

  it('主线 lane 沿用会话 id 作键——旧草稿与「切 lane 不重置」的原意都不变', () => {
    expect(draftKeyOf('s1', null)).toBe('s1')
  })

  it('追问 lane 各有独立键，同会话内互不覆盖', () => {
    expect(draftKeyOf('s1', 'q1')).not.toBe(draftKeyOf('s1', null))
    expect(draftKeyOf('s1', 'q1')).not.toBe(draftKeyOf('s1', 'q2'))
  })
})

describe('草稿读写按 lane 隔离', () => {
  beforeEach(() => clearAllDrafts())

  it('往右栏 lane 写不污染主线草稿', () => {
    setDraftText('s1', '右栏的话', 'q1')
    expect(getDraft('s1', 'q1').text).toBe('右栏的话')
    expect(getDraft('s1').text).toBe('')
  })

  it('主线与多个追问 lane 各自独立累积', () => {
    setDraftText('s1', '主线', null)
    setDraftText('s1', '一层追问', 'q1')
    setDraftText('s1', '二层追问', 'q2')
    expect(getDraft('s1', null).text).toBe('主线')
    expect(getDraft('s1', 'q1').text).toBe('一层追问')
    expect(getDraft('s1', 'q2').text).toBe('二层追问')
  })

  it('发送后只清该 lane 的草稿，其他 lane 保留', () => {
    setDraftText('s1', '主线', null)
    setDraftText('s1', '右栏', 'q1')
    clearSentDraft('s1', 'q1')
    expect(getDraft('s1', 'q1').text).toBe('')
    expect(getDraft('s1', null).text).toBe('主线')
  })

  it('删除会话时清掉该会话所有 lane 的草稿，别的会话不受影响', () => {
    setDraftText('s1', '主线', null)
    setDraftText('s1', '一层', 'q1')
    setDraftText('s2', '另一个会话', null)
    clearDraft('s1')
    expect(getDraft('s1', null).text).toBe('')
    expect(getDraft('s1', 'q1').text).toBe('')
    expect(getDraft('s2', null).text).toBe('另一个会话')
  })
})
