// 编辑器 webview CSP 装配契约（#130）：期望字符串的纯逻辑断言。真实宿主
// 内 CSP 是否按此生效由集成测试钉住（#37 教训：样式注入失效时 DOM 断言
// 照样绿，CSP 边界必须在真实 webview 宿主验证）；本测试钉住装配产物的
// 词法形态——脚本装载面不放宽（nonce 门控）、明文 http 不放行、样式/字体
// 面放行 https。script-src 的 'wasm-unsafe-eval'（#239 jieba wasm 实例化
// 的最小必要放行，#241 评审修复补上并钉住）以精确等值断言锁定：移除即红
// （收紧即红——防止后续以「最小化」名义静默回退导致 jieba 端到端失效）。
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

  it("script-src：cspSource + nonce + 'wasm-unsafe-eval'（精确等值，收紧即红）；不放行 https:/unsafe-inline/unsafe-eval", () => {
    // #239 jieba wasm：动态 import 产物内 WebAssembly.instantiate 需要
    // 'wasm-unsafe-eval'（Chromium 无此源表达式时拒绝 wasm 编译，引擎恒
    // 回退 builtin）。#241 评审修复补上；toEqual 精确等值——任何移除/
    // 追加（含误放行 unsafe-eval）都会红
    const script = directives.get('script-src')
    expect(script).toEqual([
      'https://vscode-webview.test-origin',
      "'nonce-nonce-abc123'",
      "'wasm-unsafe-eval'",
    ])
    // 放行面只此一枚 eval 类源表达式：不因 wasm 需求顺带打开 JS eval
    expect(script?.filter((tok) => tok.includes('eval'))).toEqual(["'wasm-unsafe-eval'"])
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

  it("#337 worker-src：精确等值 ['blob:']——PDF.js worker 的 Blob URL 装配（移除即红：#334 探针实证生产 CSP 原样时 new Worker(blob:) 抛 SecurityError；收紧即红：不放行其他源)", () => {
    // worker 走「esbuild 单文件产物 → fetch 文本 → Blob → objectURL」装配
    //（官方 webview worker 指南允许 data:/blob:）；worker-src 缺省回落
    // script-src，nonce 门控不放行 blob:——故须独立指令。只放行 blob:，
    // 不放行 data:（探针未用）与任何 http(s): 源
    expect(directives.get('worker-src')).toEqual(['blob:'])
  })

  it('指令集穷举（新增指令须随测试更新语义说明）', () => {
    expect([...directives.keys()].sort()).toEqual(
      ['connect-src', 'default-src', 'font-src', 'img-src', 'script-src', 'style-src', 'worker-src'],
    )
  })

  it('nonce 原样内插（不逃逸引号/分号——CSP 头注入防线）', () => {
    const csp2 = buildEditorCsp('https://x', 'nonce-with"quote')
    // nonce 含引号属宿主装配异常输入；产物仍须是分号分隔的完整指令串
    // （此处只钉住不抛异常与基本形态，nonce 值来自 randomUUID）
    expect(csp2).toContain('script-src')
  })
})
