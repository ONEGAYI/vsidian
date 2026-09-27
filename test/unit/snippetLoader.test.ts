// @vitest-environment jsdom
// CSS 片段 <link> 装配器契约（#128）：装载/晋升/失败保留/停用撤下/幂等/
// 确定性顺序（后者覆盖）。jsdom 不抓取外部样式表——load/error 经合成事件
// 驱动（真实浏览器抓取与层叠效果由 test/browser/cssSnippets.mjs 钉住）。
import { describe, it, expect, beforeEach } from 'vitest'
import { SnippetLoader, SNIPPET_LINK_ATTR, type SnippetLoadOutcome } from '../../src/webview/snippetLoader'

// jsdom 的 document.head 跨用例共享：残留链会干扰 selector 命中，逐用例清场
beforeEach(() => {
  document.head.querySelectorAll(`link[${SNIPPET_LINK_ATTR}]`).forEach((el) => el.remove())
})

/** 触发链元素的 load/error（jsdom 无真实抓取，合成事件驱动状态机） */
function fireLoad(link: HTMLLinkElement): void {
  link.dispatchEvent(new Event('load'))
}
function fireError(link: HTMLLinkElement): void {
  link.dispatchEvent(new Event('error'))
}

function linkOf(name: string): HTMLLinkElement | undefined {
  return document.head.querySelector<HTMLLinkElement>(`link[${SNIPPET_LINK_ATTR}="${name}"]`) ?? undefined
}

function headSnippetNames(): string[] {
  return [...document.head.querySelectorAll<HTMLLinkElement>(`link[${SNIPPET_LINK_ATTR}]`)].map(
    (el) => el.getAttribute(SNIPPET_LINK_ATTR) ?? '',
  )
}

describe('装载与晋升（成功路径）', () => {
  it('新清单挂 pending 链；load 后晋升 settled，href/data 属性正确', () => {
    const loader = new SnippetLoader()
    loader.apply({ version: 1, snippets: [{ name: 'a.css', uri: 'https://w/a.css?v=1' }] })
    let link = linkOf('a.css')
    expect(link).toBeTruthy()
    expect(link!.getAttribute('href')).toBe('https://w/a.css?v=1')
    expect(loader.describe()).toEqual([{ name: 'a.css', href: 'https://w/a.css?v=1', state: 'pending' }])
    expect(loader.loadedNames()).toEqual([])
    fireLoad(link!)
    expect(loader.describe()).toEqual([{ name: 'a.css', href: 'https://w/a.css?v=1', state: 'settled' }])
    expect(loader.loadedNames()).toEqual(['a.css'])
  })

  it('load 结果回报：成功与失败都携带触发版本', () => {
    const loader = new SnippetLoader()
    const outcomes: SnippetLoadOutcome[] = []
    loader.apply({ version: 7, snippets: [{ name: 'a.css', uri: 'https://w/a.css?v=7' }] }, (o) => outcomes.push(o))
    fireLoad(linkOf('a.css')!)
    expect(outcomes).toEqual([{ name: 'a.css', version: 7, ok: true }])
  })
})

describe('热替换与失败保留', () => {
  it('版本更新重挂新链；新链 load 前旧链仍在 DOM（无空窗），load 后旧链摘除', () => {
    const loader = new SnippetLoader()
    loader.apply({ version: 1, snippets: [{ name: 'a.css', uri: 'https://w/a.css?v=1' }] })
    fireLoad(linkOf('a.css')!)
    loader.apply({ version: 2, snippets: [{ name: 'a.css', uri: 'https://w/a.css?v=2' }] })
    // 新旧并存：旧链生效直到新链加载完成
    expect(headSnippetNames().filter((n) => n === 'a.css')).toHaveLength(2)
    expect(loader.loadedNames()).toEqual(['a.css'])
    // 已晋升链重复收到 load（幂等守卫）：不误摘生效链
    const settledEl = [...document.head.querySelectorAll<HTMLLinkElement>(`link[${SNIPPET_LINK_ATTR}="a.css"]`)]
      .find((node) => node.getAttribute('href') === 'https://w/a.css?v=1')!
    fireLoad(settledEl)
    expect(loader.loadedNames()).toEqual(['a.css'])
    // 用 describe 精确驱动：pending 是 v=2 那条
    const pending = loader.describe().find((s) => s.state === 'pending')!
    const el = [...document.head.querySelectorAll<HTMLLinkElement>(`link[${SNIPPET_LINK_ATTR}="a.css"]`)]
      .find((node) => node.getAttribute('href') === pending.href)!
    fireLoad(el)
    expect(loader.describe()).toEqual([{ name: 'a.css', href: 'https://w/a.css?v=2', state: 'settled' }])
    expect(headSnippetNames()).toEqual(['a.css'])
  })

  it('新链加载失败：失败链移除、旧链保留、回报 ok=false（最近成功样式不丢）', () => {
    const loader = new SnippetLoader()
    const outcomes: SnippetLoadOutcome[] = []
    loader.apply({ version: 1, snippets: [{ name: 'a.css', uri: 'https://w/a.css?v=1' }] }, (o) => outcomes.push(o))
    fireLoad(linkOf('a.css')!)
    loader.apply({ version: 2, snippets: [{ name: 'a.css', uri: 'https://w/a.css?v=2' }] }, (o) => outcomes.push(o))
    const pending = loader.describe().find((s) => s.state === 'pending')!
    const el = [...document.head.querySelectorAll<HTMLLinkElement>(`link[${SNIPPET_LINK_ATTR}="a.css"]`)]
      .find((node) => node.getAttribute('href') === pending.href)!
    fireError(el)
    expect(loader.describe()).toEqual([{ name: 'a.css', href: 'https://w/a.css?v=1', state: 'settled' }])
    expect(headSnippetNames()).toEqual(['a.css'])
    expect(outcomes.at(-1)).toEqual({ name: 'a.css', version: 2, ok: false })
  })

  it('首次装载即失败：无 settled 可保留，链移除并回报', () => {
    const loader = new SnippetLoader()
    const outcomes: SnippetLoadOutcome[] = []
    loader.apply({ version: 1, snippets: [{ name: 'a.css', uri: 'https://w/missing.css?v=1' }] }, (o) => outcomes.push(o))
    fireError(linkOf('a.css')!)
    expect(headSnippetNames()).toEqual([])
    expect(outcomes).toEqual([{ name: 'a.css', version: 1, ok: false }])
  })
})

describe('停用撤下与幂等', () => {
  it('不在清单即摘链（明确停用/删除立即撤下）', () => {
    const loader = new SnippetLoader()
    loader.apply({ version: 1, snippets: [
      { name: 'a.css', uri: 'https://w/a.css?v=1' },
      { name: 'b.css', uri: 'https://w/b.css?v=1' },
    ] })
    fireLoad(linkOf('a.css')!)
    fireLoad(linkOf('b.css')!)
    // 停用 b（版本推进 → a 的 URI 也带新版本参数，进入热替换）
    loader.apply({ version: 2, snippets: [{ name: 'a.css', uri: 'https://w/a.css?v=2' }] })
    expect(headSnippetNames().filter((n) => n === 'b.css')).toEqual([])
    expect(headSnippetNames().filter((n) => n === 'a.css').length).toBe(2) // settled v1 + pending v2
    // 清空清单撤下全部
    loader.apply({ version: 3, snippets: [] })
    expect(headSnippetNames()).toEqual([])
    expect(loader.loadedNames()).toEqual([])
  })

  it('同 URI 重复 apply 不重挂（幂等，无重复链）', () => {
    const loader = new SnippetLoader()
    loader.apply({ version: 1, snippets: [{ name: 'a.css', uri: 'https://w/a.css?v=1' }] })
    fireLoad(linkOf('a.css')!)
    loader.apply({ version: 1, snippets: [{ name: 'a.css', uri: 'https://w/a.css?v=1' }] })
    expect(headSnippetNames()).toEqual(['a.css'])
    expect(loader.describe()).toEqual([{ name: 'a.css', href: 'https://w/a.css?v=1', state: 'settled' }])
  })

  it('热替换中途再次 apply 新版本：被取代的 pending 不再晋升（陈旧结果丢弃）', () => {
    const loader = new SnippetLoader()
    loader.apply({ version: 1, snippets: [{ name: 'a.css', uri: 'https://w/a.css?v=1' }] })
    fireLoad(linkOf('a.css')!)
    loader.apply({ version: 2, snippets: [{ name: 'a.css', uri: 'https://w/a.css?v=2' }] })
    const stale = linkOf('a.css')!
    loader.apply({ version: 3, snippets: [{ name: 'a.css', uri: 'https://w/a.css?v=3' }] })
    // v2 链被取代：其 load 到达只做移除，不晋升
    fireLoad(stale)
    expect(loader.describe().map((s) => s.href)).not.toContain('https://w/a.css?v=2')
    expect(loader.loadedNames()).toEqual(['a.css']) // v=1 仍生效
    // v3 正常晋升
    const current = loader.describe().find((s) => s.state === 'pending')!
    fireLoad([...document.head.querySelectorAll<HTMLLinkElement>(`link[${SNIPPET_LINK_ATTR}="a.css"]`)]
      .find((node) => node.getAttribute('href') === current.href)!)
    expect(loader.describe()).toEqual([{ name: 'a.css', href: 'https://w/a.css?v=3', state: 'settled' }])
  })
})

describe('确定性顺序（后者覆盖）', () => {
  it('settled 链按清单顺序在 DOM 排列；乱序 apply 后重排', () => {
    const loader = new SnippetLoader()
    loader.apply({ version: 1, snippets: [
      { name: 'b.css', uri: 'https://w/b.css?v=1' },
      { name: 'a.css', uri: 'https://w/a.css?v=1' },
    ] })
    fireLoad(linkOf('b.css')!)
    fireLoad(linkOf('a.css')!)
    // 宿主下发已按文件名排序；loader 按下发顺序排列（此处显式乱序验证重排）
    expect(headSnippetNames()).toEqual(['b.css', 'a.css'])
    loader.apply({ version: 2, snippets: [
      { name: 'a.css', uri: 'https://w/a.css?v=2' },
      { name: 'b.css', uri: 'https://w/b.css?v=2' },
    ] })
    // settled（旧 href）先重排；pending 追加在后
    expect(headSnippetNames().indexOf('a.css')).toBeLessThan(headSnippetNames().lastIndexOf('b.css') + 1)
    // 全部晋升后为严格 a、b 序
    for (const info of loader.describe().filter((s) => s.state === 'pending')) {
      fireLoad([...document.head.querySelectorAll<HTMLLinkElement>(`link[${SNIPPET_LINK_ATTR}="${info.name}"]`)]
        .find((node) => node.getAttribute('href') === info.href)!)
    }
    expect(headSnippetNames()).toEqual(['a.css', 'b.css'])
  })
})

describe('clear', () => {
  it('摘除全部链（含 pending）', () => {
    const loader = new SnippetLoader()
    loader.apply({ version: 1, snippets: [{ name: 'a.css', uri: 'https://w/a.css?v=1' }] })
    loader.clear()
    expect(headSnippetNames()).toEqual([])
    expect(loader.describe()).toEqual([])
  })
})
