// 编辑器 webview CSP 装配契约（#130）：期望字符串的纯逻辑断言。真实宿主
// 内 CSP 是否按此生效由集成测试钉住（#37 教训：样式注入失效时 DOM 断言
// 照样绿，CSP 边界必须在真实 webview 宿主验证）；本测试钉住装配产物的
// 词法形态——脚本面不放宽、明文 http 不放行、样式/字体面放行 https。
import { describe, it, expect } from 'vitest'
import { buildEditorCsp } from '../../src/host/editorCsp'

/** 按 CSP 源表达式切词（directive ; 分隔、source 空白分隔） */
function directivesOf(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    if (tokens.length > 0) {
      out.set(tokens[0]!, tokens.slice(1))
    }
  }
  return out
}

describe('编辑器 CSP 装配（#130 HTTPS 样式导入与联网字体）', () => {
  const csp = buildEditorCsp('https://vscode-webview.test-origin', 'nonce-abc123')
  const directives = directivesOf(csp)

  it("default-src 'none' 保持收紧（未列出的装载类全禁）", () => {
    expect(directives.get('default-src')).toEqual(["'none'"])
  })

  it('style-src：cspSource + unsafe-inline + https:（HTTPS @import 与远程样式表）', () => {
    expect(directives.get('style-src')).toEqual([
      'https://vscode-webview.test-origin',
      "'unsafe-inline'",
      'https:',
    ])
  })

  it('font-src：cspSource + https:（@font-face 远程字体，含远程表内相对 URL）', () => {
    expect(directives.get('font-src')).toEqual(['https://vscode-webview.test-origin', 'https:'])
  })

  it('img-src 维持既有放行面（cspSource + https: + data:，#111 落档）', () => {
    expect(directives.get('img-src')).toEqual([
      'https://vscode-webview.test-origin',
      'https:',
      'data:',
    ])
  })

  it('script-src 不放宽：仅 cspSource + nonce，无 https:/unsafe-inline/unsafe-eval', () => {
    const script = directives.get('script-src')
    expect(script).toEqual(['https://vscode-webview.test-origin', "'nonce-nonce-abc123'"])
  })

  it('协议边界：明文 http: 源不放行（任何指令都不含 http: 源表达式）', () => {
    for (const [name, sources] of directives) {
      expect(sources, `${name} 不得放行明文 http:`).not.toContain('http:')
    }
    // 词法防绕：整串不得出现独立的 http: 源记号（https: 内含子串属正常）
    const tokens = csp.split(/[\s;]+/).filter(Boolean)
    expect(tokens.filter((tok) => tok === 'http:')).toEqual([])
  })

  it('connect-src 仅放行 cspSource（#239 jieba wasm 经 init(url) 内部 fetch 装载；不开 https:/http: 外网）', () => {
    expect(directives.get('connect-src')).toEqual(['https://vscode-webview.test-origin'])
  })

  it('指令集穷举（新增指令须随测试更新语义说明）', () => {
    expect([...directives.keys()].sort()).toEqual(
      ['connect-src', 'default-src', 'font-src', 'img-src', 'script-src', 'style-src'],
    )
  })

  it('nonce 原样内插（不逃逸引号/分号——CSP 头注入防线）', () => {
    const csp2 = buildEditorCsp('https://x', 'nonce-with"quote')
    // nonce 含引号属宿主装配异常输入；产物仍须是分号分隔的完整指令串
    // （此处只钉住不抛异常与基本形态，nonce 值来自 randomUUID）
    expect(csp2).toContain('script-src')
  })
})
