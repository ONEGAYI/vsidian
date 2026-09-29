// 悬停预览消息协议契约（#218）：hover.request / hover.result 的运行期
// 校验器行为——校验器与联合类型三处不同步 = 静默丢消息（protocol-notes
// 陷阱清单），此处钉住合法形态放行、非法形态整体拒绝（不部分读取）。
import { describe, expect, it } from 'vitest'
import {
  isHostToWebview,
  isWebviewToHost,
  type HostToWebview,
  type WebviewToHost,
} from '../../src/shared/protocol'

/** 合法 hover.request 基线（会话守卫字段 + 实例身份 + 源位置 + 目标原文） */
function validRequest(): WebviewToHost {
  return {
    kind: 'hover.request',
    sessionId: 'panel-1',
    docUri: 'file:///d%3A/notes/a.md',
    reqId: 1,
    instanceId: 'hover-1',
    sourceStart: 12,
    sourceEnd: 24,
    target: '目标笔记',
  }
}

/** 合法 hover.result 成功形态基线（规范目标身份 + 版本 + LF 全文 + 范围） */
function validResultOk(): HostToWebview {
  return {
    kind: 'hover.result',
    reqId: 1,
    instanceId: 'hover-1',
    ok: true,
    target: { fsPath: 'D:\\notes\\目标笔记.md', relPath: '目标笔记.md' },
    version: 3,
    text: '# 标题\n\n正文\n',
    range: { start: 0, end: 13 },
    scope: { kind: 'full' },
  }
}

/** 合法 hover.result 失败形态基线（就地错误分态） */
function validResultFail(): HostToWebview {
  return {
    kind: 'hover.result',
    reqId: 1,
    instanceId: 'hover-1',
    ok: false,
    reason: 'not-found',
  }
}

describe('hover.request 校验（webview → 宿主）', () => {
  it('合法形态放行', () => {
    expect(isWebviewToHost(validRequest())).toBe(true)
  })

  it('缺任一会话守卫/身份字段整体拒绝', () => {
    const base = validRequest() as Record<string, unknown>
    for (const key of ['sessionId', 'docUri', 'reqId', 'instanceId', 'sourceStart', 'sourceEnd', 'target']) {
      const broken: Record<string, unknown> = { ...base }
      delete broken[key]
      expect(isWebviewToHost(broken), `缺 ${key} 应拒绝`).toBe(false)
    }
  })

  it('reqId 须为正整数；offset 与身份须为非负整数/非空字符串', () => {
    expect(isWebviewToHost({ ...validRequest(), reqId: 0 })).toBe(false)
    expect(isWebviewToHost({ ...validRequest(), reqId: 1.5 })).toBe(false)
    expect(isWebviewToHost({ ...validRequest(), sourceStart: -1 })).toBe(false)
    expect(isWebviewToHost({ ...validRequest(), sourceEnd: -1 })).toBe(false)
    expect(isWebviewToHost({ ...validRequest(), instanceId: '' })).toBe(false)
    expect(isWebviewToHost({ ...validRequest(), target: 3 })).toBe(false)
  })

  it('#219 普通链接形态：linkHref 可选字符串（缺省双链；非字符串拒绝）', () => {
    expect(isWebviewToHost({ ...validRequest(), linkHref: 'relative.md#章' })).toBe(true)
    expect(isWebviewToHost(validRequest()), '缺省仍为双链形态').toBe(true)
    expect(isWebviewToHost({ ...validRequest(), linkHref: 3 })).toBe(false)
  })
})

describe('hover.result 校验（宿主 → webview）', () => {
  it('成功与失败两形态均放行', () => {
    expect(isHostToWebview(validResultOk())).toBe(true)
    expect(isHostToWebview(validResultFail())).toBe(true)
  })

  it('reqId/instanceId 缺失或非法整体拒绝', () => {
    expect(isHostToWebview({ ...validResultOk(), reqId: 0 } as unknown as Record<string, unknown>)).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), instanceId: '' } as unknown as Record<string, unknown>)).toBe(false)
    const noReq: Record<string, unknown> = { ...(validResultOk() as unknown as Record<string, unknown>) }
    delete noReq['reqId']
    expect(isHostToWebview(noReq)).toBe(false)
  })

  it('成功形态须携带完整目标身份/版本/全文/范围/范围选择器', () => {
    const base = validResultOk() as unknown as Record<string, unknown>
    for (const key of ['target', 'version', 'text', 'range', 'scope']) {
      const broken: Record<string, unknown> = { ...base }
      delete broken[key]
      expect(isHostToWebview(broken), `成功形态缺 ${key} 应拒绝`).toBe(false)
    }
    expect(isHostToWebview({ ...base, version: -1 })).toBe(false)
    expect(isHostToWebview({ ...base, range: { start: 5, end: 2 } })).toBe(false)
    expect(isHostToWebview({ ...base, scope: { kind: 'unknown' } })).toBe(false)
    expect(
      isHostToWebview({ ...base, target: { fsPath: 'x.md' } }),
      '目标身份缺 relPath 应拒绝',
    ).toBe(false)
  })

  it('失败形态 reason 限定错误分态枚举；未知 reason 拒绝', () => {
    const base = validResultFail() as unknown as Record<string, unknown>
    for (const reason of ['unsupported', 'no-workspace', 'escape', 'not-found', 'non-markdown', 'read-failed', 'anchor-missing']) {
      expect(isHostToWebview({ ...base, reason }), `reason=${reason} 应放行`).toBe(true)
    }
    expect(isHostToWebview({ ...base, reason: 'whatever' })).toBe(false)
    expect(isHostToWebview({ ...base, ok: true, reason: 'not-found' })).toBe(false)
  })

  it('#219 失败形态 anchor（锚点原文）可选字符串；非字符串拒绝', () => {
    const base = validResultFail() as unknown as Record<string, unknown>
    expect(isHostToWebview({ ...base, reason: 'anchor-missing', anchor: '不存在的标题' })).toBe(true)
    expect(isHostToWebview({ ...base, reason: 'anchor-missing' }), 'anchor 可缺省').toBe(true)
    expect(isHostToWebview({ ...base, anchor: 3 })).toBe(false)
  })

  it('#219 成功形态 scope 三态：full / heading（附锚点）/ block（附 ^ 前缀锚点）', () => {
    const base = validResultOk() as unknown as Record<string, unknown>
    expect(isHostToWebview({ ...base, scope: { kind: 'heading', anchor: '章节' } })).toBe(true)
    expect(isHostToWebview({ ...base, scope: { kind: 'block', anchor: '^blk1' } })).toBe(true)
    expect(isHostToWebview({ ...base, scope: { kind: 'heading' } }), 'heading 缺 anchor 应拒绝').toBe(false)
    expect(isHostToWebview({ ...base, scope: { kind: 'block', anchor: 3 } })).toBe(false)
  })
})
