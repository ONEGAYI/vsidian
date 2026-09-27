// CSS 片段本地依赖导入纯逻辑契约（#129）：@import 与 url() 的形态学扫描
// （标准条件语义：media/supports/layer）、引用分类、按「各自 CSS 文件路径」
// 的相对解析、目录包含判定（越界）、依赖闭包遍历（嵌套导入、循环有界、
// 缺失引用、符号链接逃逸）。全部纯函数 + 注入读写端口，不依赖 vscode/DOM。
//
// 边界声明（与实现约定一致，非完整 CSS 解析器）：
// - 只识别 CSSOM 会实际生效的顶层 @import（出现在首个生效规则之前；
//   @charset 与 @layer 声明不关闭导入窗口）——块内或规则后的 @import 被
//   浏览器忽略，宿主侧也不计入依赖（避免过度归因与过度拒绝）。
// - 字符串转义只处理「反斜杠 + 下一字符」（\" \' \\）；十六进制转义不展开。
// - 非本地引用（http(s)/data/fragment）不参与路径解析与越界判定。
import { describe, it, expect } from 'vitest'
import {
  classifyCssRef,
  scanCssReferences,
  normalizeSnippetPath,
  resolveCssRefPath,
  isPathWithinSnippetDirectory,
  analyzeSnippetEntry,
  type SnippetAnalysisPorts,
} from '../../src/shared/cssSnippetImports'

const importsOf = (css: string) => scanCssReferences(css).imports.map((i) => i.spec)
const assetsOf = (css: string) => scanCssReferences(css).assets.map((a) => a.spec)

describe('scanCssReferences：@import 形态', () => {
  it('字符串与 url() 两种基本形态（单双引号、带引号 url）', () => {
    expect(importsOf('@import "sub/a.css";')).toEqual(['sub/a.css'])
    expect(importsOf("@import 'sub/a.css';")).toEqual(['sub/a.css'])
    expect(importsOf('@import url(sub/a.css);')).toEqual(['sub/a.css'])
    expect(importsOf('@import url("sub/a.css");')).toEqual(["sub/a.css"])
    expect(importsOf("@import url('sub/a.css');")).toEqual(['sub/a.css'])
  })

  it('标准条件语义：media 查询、layer、supports 及其组合（前后置 layer）', () => {
    expect(importsOf('@import "a.css" screen and (min-width: 400px);')).toEqual(['a.css'])
    expect(importsOf('@import "a.css" print;')).toEqual(['a.css'])
    expect(importsOf('@import "a.css" layer;')).toEqual(['a.css'])
    expect(importsOf('@import "a.css" layer(base);')).toEqual(['a.css'])
    expect(importsOf('@import "a.css" supports(display: grid);')).toEqual(['a.css'])
    expect(importsOf('@import "a.css" supports(display: grid) screen;')).toEqual(['a.css'])
    expect(importsOf('@import layer(base) url(a.css);')).toEqual(['a.css'])
    expect(importsOf('@import layer(base) "a.css" screen;')).toEqual(['a.css'])
    expect(importsOf('@import url(a.css) layer(x) supports(display: flex) screen;')).toEqual(['a.css'])
  })

  it('supports 条件内的 url() 不被误认为导入地址，也不计为资产', () => {
    const scan = scanCssReferences('@import "a.css" supports(background-image: url(b.png));')
    expect(scan.imports.map((i) => i.spec)).toEqual(['a.css'])
    expect(scan.assets).toEqual([])
  })

  it('多条导入与空白换行、分号后继续扫描', () => {
    const css = [
      '/* 主题拆分 */',
      '@import "base.css";',
      '  @import url(sub/dep.css) screen;',
      "@import 'last.css' layer;",
    ].join('\n')
    expect(importsOf(css)).toEqual(['base.css', 'sub/dep.css', 'last.css'])
  })

  it('注释中的 @import 不识别；字符串内的 @import 文本不识别', () => {
    expect(importsOf('/* @import "fake.css"; */ @import "real.css";')).toEqual(['real.css'])
    expect(importsOf('@import "real.css"; .a::after { content: "@import \'x.css\'"; }')).toEqual(['real.css'])
  })

  it('块内（@media 等）与非顶层 @import 不识别——浏览器同样忽略；规则后的导入全部失效', () => {
    // 嵌套在块内的导入无效，但其后的顶层导入先于任何规则时有效
    expect(importsOf('@import "b.css"; @media print { @import "a.css"; }')).toEqual(['b.css'])
    // 反过来：块规则出现在前，其后的导入按 CSSOM 一并忽略
    expect(importsOf('@media print { @import "a.css"; } @import "b.css";')).toEqual([])
    // 普通规则之后的导入同样失效（含其后所有导入）
    expect(importsOf('.a { color: red; } @import "late.css"; @import "b.css";')).toEqual([])
  })

  it('导入窗口：@charset 与 @layer 声明不关闭，@layer 块关闭', () => {
    expect(importsOf('@charset "utf-8"; @import "a.css";')).toEqual(['a.css'])
    expect(importsOf('@layer a, b; @import "a.css";')).toEqual(['a.css'])
    expect(importsOf('@layer base { .a { color: red; } } @import "a.css"; @import "b.css";')).toEqual([])
    expect(importsOf('@import "b.css"; @layer base { .a { color: red; } } @import "a.css";')).toEqual(['b.css'])
  })

  it('未闭合的导入（缺分号到文件尾）宽松识别；无地址的导入不产出条目', () => {
    expect(importsOf('@import "a.css"')).toEqual(['a.css'])
    expect(importsOf('@import screen;')).toEqual([])
  })

  it('字符串内转义引号；引号后到分号的条件段照常解析', () => {
    expect(importsOf('@import "a\\"b.css";')).toEqual(['a"b.css'])
    expect(importsOf("@import 'it\\'s.css' screen;")).toEqual(["it's.css"])
  })

  it('导入地址分类：http(s)/data/根相对/带协议绝对/相对', () => {
    const classify = (css: string) => scanCssReferences(css).imports[0]?.kind
    expect(classify('@import "https://cdn.example/a.css";')).toBe('http')
    expect(classify('@import "//cdn.example/a.css";')).toBe('http')
    expect(classify('@import url(data:text/css,.a{});')).toBe('data')
    expect(classify('@import "/root-relative.css";')).toBe('root-relative')
    expect(classify('@import "file:///D:/evil.css";')).toBe('absolute')
    expect(classify('@import "./sibling.css";')).toBe('relative')
    expect(classify('@import "sub/deep.css";')).toBe('relative')
  })
})

describe('scanCssReferences：url() 资产引用', () => {
  it('声明内 url() 计为资产（背景、字体 src 等），支持引号与空格', () => {
    expect(assetsOf('.a { background: url(img/x.png); }')).toEqual(['img/x.png'])
    expect(assetsOf('.a { background: url("img/x y.png"); }')).toEqual(['img/x y.png'])
    expect(assetsOf("@font-face { src: url('f.woff2') format('woff2'); }")).toEqual(['f.woff2'])
  })

  it('资产分类：data/https/fragment/根相对/file 协议/空 url', () => {
    const classify = (css: string) => scanCssReferences(css).assets[0]?.kind
    expect(classify('.a{background:url(data:image/png;base64,AAA)}')).toBe('data')
    expect(classify('.a{background:url(https://x/y.png)}')).toBe('http')
    expect(classify('.a{background:url(#grad)}')).toBe('fragment')
    expect(classify('.a{background:url(/abs.png)}')).toBe('root-relative')
    expect(classify('.a{background:url(file:///D:/x.png)}')).toBe('absolute')
    expect(classify('.a{background:url()}')).toBe('empty')
    expect(assetsOf('.a{background:url()}')).toEqual([''])
  })

  it('注释内的 url() 不识别；@import 预备段内的 url() 不重复计资产', () => {
    expect(assetsOf('/* url(c.png) */ .a{background:url(d.png)}')).toEqual(['d.png'])
    expect(assetsOf('@import url(a.css); .a{background:url(b.png)}')).toEqual(['b.png'])
  })

  it('URL 大小写形态（URL( )）与括号内空白容忍', () => {
    expect(assetsOf('.a{background:URL( img.png )}')).toEqual(['img.png'])
  })
})

describe('classifyCssRef / normalizeSnippetPath / resolveCssRefPath', () => {
  it('classifyCssRef：七类判定', () => {
    expect(classifyCssRef('sub/a.css')).toBe('relative')
    expect(classifyCssRef('./a.css')).toBe('relative')
    expect(classifyCssRef('../a.css')).toBe('relative')
    expect(classifyCssRef('/a.css')).toBe('root-relative')
    expect(classifyCssRef('\\a.css')).toBe('root-relative')
    expect(classifyCssRef('https://x/a.css')).toBe('http')
    expect(classifyCssRef('HTTP://X/a.css')).toBe('http')
    expect(classifyCssRef('//x/a.css')).toBe('http')
    expect(classifyCssRef('data:text/css,.a{}')).toBe('data')
    expect(classifyCssRef('file:///D:/a.css')).toBe('absolute')
    expect(classifyCssRef('vscode-webview://x/a.css')).toBe('absolute')
    expect(classifyCssRef('#frag')).toBe('fragment')
    expect(classifyCssRef('')).toBe('empty')
    expect(classifyCssRef('  ')).toBe('empty')
  })

  it('normalizeSnippetPath：反斜杠归一、点段折叠、越界 .. 保留（供包含判定拒绝）', () => {
    expect(normalizeSnippetPath('D:\\snips\\sub\\..\\a.css')).toBe('D:/snips/a.css')
    expect(normalizeSnippetPath('D:/snips/./sub/x.css')).toBe('D:/snips/sub/x.css')
    expect(normalizeSnippetPath('/srv/snips/a.css')).toBe('/srv/snips/a.css')
    expect(normalizeSnippetPath('D:/snips/../../evil.css')).toBe('D:/evil.css')
    expect(normalizeSnippetPath('D:/snips/sub/../../evil.css')).toBe('D:/evil.css')
  })

  it('resolveCssRefPath：相对导入按「导入方文件所在目录」解析', () => {
    expect(resolveCssRefPath('D:/snips/a.css', 'sub/dep.css')).toBe('D:/snips/sub/dep.css')
    expect(resolveCssRefPath('D:/snips/sub/a.css', '../dep.css')).toBe('D:/snips/dep.css')
    expect(resolveCssRefPath('D:\\snips\\sub\\a.css', 'deep/b.css')).toBe('D:/snips/sub/deep/b.css')
    // 百分号转义解码（含空格与中文）
    expect(resolveCssRefPath('D:/snips/a.css', 'my%20dep.css')).toBe('D:/snips/my dep.css')
    expect(resolveCssRefPath('D:/snips/a.css', '%E4%BE%9D%E8%B5%96.css')).toBe('D:/snips/依赖.css')
    // 非相对引用不解析（调用方按分类处置）
    expect(resolveCssRefPath('D:/snips/a.css', 'https://x/a.css')).toBeNull()
    expect(resolveCssRefPath('D:/snips/a.css', '/root.css')).toBeNull()
    expect(resolveCssRefPath('D:/snips/a.css', '#f')).toBeNull()
    // 非法百分号序列回退原文
    expect(resolveCssRefPath('D:/snips/a.css', 'a%zz.css')).toBe('D:/snips/a%zz.css')
  })

  it('isPathWithinSnippetDirectory：目录段边界精确、目录自身算在内', () => {
    expect(isPathWithinSnippetDirectory('D:/snips', 'D:/snips/a.css')).toBe(true)
    expect(isPathWithinSnippetDirectory('D:/snips', 'D:/snips/sub/a.css')).toBe(true)
    expect(isPathWithinSnippetDirectory('D:/snips', 'D:/snips')).toBe(true)
    expect(isPathWithinSnippetDirectory('D:/snips', 'D:/snips2/a.css')).toBe(false)
    expect(isPathWithinSnippetDirectory('D:/snips', 'D:/evil.css')).toBe(false)
    expect(isPathWithinSnippetDirectory('/srv/snips', '/srv/snips2/a.css')).toBe(false)
  })
})

/** 内存文件系统端口：readText 按 Map（键按归一化形态查——真实 fs 不区分
 *  斜杠方向，假件同样收敛），realpath 按映射表（默认恒等） */
function makePorts(
  files: Record<string, string>,
  realpaths: Record<string, string> = {},
): SnippetAnalysisPorts {
  const normFiles = new Map(Object.entries(files).map(([k, v]) => [normalizeSnippetPath(k), v]))
  const normReal = new Map(Object.entries(realpaths).map(([k, v]) => [normalizeSnippetPath(k), normalizeSnippetPath(v)]))
  return {
    readText: async (p) => normFiles.get(normalizeSnippetPath(p)) ?? null,
    realpath: async (p) => normReal.get(normalizeSnippetPath(p)) ?? normalizeSnippetPath(p),
  }
}

describe('analyzeSnippetEntry：依赖闭包与越界拒绝', () => {
  const DIR = 'D:/snips'

  it('嵌套导入收集全部本地依赖（含被导入文件的再导入）', async () => {
    const ports = makePorts({
      'D:/snips/main.css': '@import "sub/dep.css";\n.a{color:red}',
      'D:/snips/sub/dep.css': '@import "dep2.css";\n.b{color:blue}',
      'D:/snips/sub/dep2.css': '.c{color:green}',
    })
    const result = await analyzeSnippetEntry(DIR, 'main.css', ports, DIR)
    expect(result).toEqual({
      ok: true,
      entryReadable: true,
      importPaths: ['D:/snips/sub/dep.css', 'D:/snips/sub/dep2.css'],
    })
  })

  it('被导入文件不要求可读：缺失目标仍入归因集（后续创建时触发重载）', async () => {
    const ports = makePorts({ 'D:/snips/main.css': '@import "sub/missing.css";\n.a{color:red}' })
    const result = await analyzeSnippetEntry(DIR, 'main.css', ports, DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.importPaths).toEqual(['D:/snips/sub/missing.css'])
      expect(result.entryReadable).toBe(true)
    }
  })

  it('入口自身不可读（原子保存窗口）：不拒绝，保留条目交由装载回报', async () => {
    const ports = makePorts({})
    const result = await analyzeSnippetEntry(DIR, 'main.css', ports, DIR)
    expect(result).toEqual({ ok: true, entryReadable: false, importPaths: [] })
  })

  it('循环导入有界完成（a↔b、自导入）：闭包去重、不挂死', async () => {
    const ports = makePorts({
      'D:/snips/a.css': '@import "b.css";\n.a{color:red}',
      'D:/snips/b.css': '@import "a.css";\n.b{color:blue}',
    })
    const result = await analyzeSnippetEntry(DIR, 'a.css', ports, DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.importPaths).toEqual(['D:/snips/b.css'])
    }
    const selfRef = makePorts({ 'D:/snips/s.css': '@import "s.css";\n.a{color:red}' })
    const selfResult = await analyzeSnippetEntry(DIR, 's.css', selfRef, DIR)
    expect(selfResult.ok).toBe(true)
    if (selfResult.ok) {
      // 自导入即入口自身：入口变更由调用方按入口路径归因，不重复入闭包
      expect(selfResult.importPaths).toEqual([])
    }
  })

  it('超深链在深度上限截断（不拒绝、不挂死）', async () => {
    const files: Record<string, string> = { 'D:/snips/main.css': '@import "d1.css";' }
    for (let i = 1; i < 80; i++) {
      files[`D:/snips/d${i}.css`] = `@import "d${i + 1}.css";`
    }
    files['D:/snips/d80.css'] = '.end{color:red}'
    const result = await analyzeSnippetEntry(DIR, 'main.css', makePorts(files), DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.importPaths.length).toBeLessThan(80)
    }
  })

  it('相对路径越界（../ 逃逸）拒绝该入口', async () => {
    const ports = makePorts({ 'D:/snips/main.css': '@import "../outside.css";' })
    await expect(analyzeSnippetEntry(DIR, 'main.css', ports, DIR)).resolves.toEqual({
      ok: false,
      reason: 'path-escape',
      path: 'D:/outside.css',
      spec: '../outside.css',
    })
  })

  it('根相对与 file: 协议导入按越界拒绝（不经片段目录资源面）', async () => {
    const rootRel = makePorts({ 'D:/snips/main.css': '@import "/etc/x.css";' })
    await expect(analyzeSnippetEntry(DIR, 'main.css', rootRel, DIR)).resolves.toMatchObject({
      ok: false,
      reason: 'path-escape',
    })
    const fileUri = makePorts({ 'D:/snips/main.css': '@import "file:///D:/evil.css";' })
    await expect(analyzeSnippetEntry(DIR, 'main.css', fileUri, DIR)).resolves.toMatchObject({
      ok: false,
      reason: 'path-escape',
    })
  })

  it('资产 url() 越界同样拒绝（图片/字体限定在片段目录内）', async () => {
    const ports = makePorts({
      'D:/snips/main.css': '.a{background:url("../../out.png")}',
    })
    await expect(analyzeSnippetEntry(DIR, 'main.css', ports, DIR)).resolves.toMatchObject({
      ok: false,
      reason: 'path-escape',
    })
    const rootAbs = makePorts({ 'D:/snips/main.css': '.a{background:url(/abs.png)}' })
    await expect(analyzeSnippetEntry(DIR, 'main.css', rootAbs, DIR)).resolves.toMatchObject({
      ok: false,
      reason: 'path-escape',
    })
  })

  it('http/data/fragment 引用不拒绝（联网字体与 HTTPS 导入属 #130/CSP 管辖）', async () => {
    const ports = makePorts({
      'D:/snips/main.css': [
        '@import "https://cdn.example/a.css";',
        '.a{background:url(data:image/png;base64,AA)}',
        '.b{background:url(#grad)}',
        '.c{background:url(https://x/f.woff2)}',
      ].join('\n'),
    })
    const result = await analyzeSnippetEntry(DIR, 'main.css', ports, DIR)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.importPaths).toEqual([])
    }
  })

  it('符号链接逃逸：realpath 落在目录外拒绝；指向目录内不拒绝', async () => {
    const escape = makePorts(
      { 'D:/snips/main.css': '@import "sub/link.css";\n.a{color:red}' },
      { 'D:/snips/sub/link.css': 'E:/outside/real.css' },
    )
    await expect(analyzeSnippetEntry(DIR, 'main.css', escape, DIR)).resolves.toEqual({
      ok: false,
      reason: 'symlink-escape',
      path: 'E:/outside/real.css',
      spec: 'sub/link.css',
    })
    const inside = makePorts(
      { 'D:/snips/main.css': '@import "sub/link.css";' },
      { 'D:/snips/sub/link.css': 'D:/snips/other/real.css' },
    )
    await expect(analyzeSnippetEntry(DIR, 'main.css', inside, DIR)).resolves.toMatchObject({ ok: true })
  })

  it('入口自身是指向目录外的符号链接：拒绝（symlink-escape）', async () => {
    const ports = makePorts(
      { 'E:/evil/theme.css': '.a{color:red}' },
      { 'D:/snips/main.css': 'E:/evil/theme.css' },
    )
    await expect(analyzeSnippetEntry(DIR, 'main.css', ports, DIR)).resolves.toMatchObject({
      ok: false,
      reason: 'symlink-escape',
    })
  })

  it('中间目录为符号链接逃逸：整条路径 realpath 判定', async () => {
    const ports = makePorts(
      { 'D:/snips/main.css': '@import "linkdir/dep.css";' },
      { 'D:/snips/linkdir/dep.css': 'E:/elsewhere/dep.css' },
    )
    await expect(analyzeSnippetEntry(DIR, 'main.css', ports, DIR)).resolves.toMatchObject({
      ok: false,
      reason: 'symlink-escape',
    })
  })

  it('资产的符号链接逃逸：拒绝；http 资产不受影响', async () => {
    const escape = makePorts(
      { 'D:/snips/main.css': '.a{background:url("linked.png")}' },
      { 'D:/snips/linked.png': 'E:/outside/img.png' },
    )
    await expect(analyzeSnippetEntry(DIR, 'main.css', escape, DIR)).resolves.toMatchObject({
      ok: false,
      reason: 'symlink-escape',
    })
  })

  it('realpath 解析失败（悬空链接）不拒绝：目标不存在即无逃逸面', async () => {
    const ports: SnippetAnalysisPorts = {
      readText: async (p) => (p === 'D:/snips/main.css' ? '@import "dangling.css";' : null),
      realpath: async (p) => (p === 'D:/snips' ? 'D:/snips' : null),
    }
    const result = await analyzeSnippetEntry(DIR, 'main.css', ports, DIR)
    expect(result.ok).toBe(true)
  })

  it('Windows 反斜杠目录形态与正斜杠等价（宿主 fsPath 与 CSS 斜杠混用）', async () => {
    const ports = makePorts({
      'D:\\snips\\main.css': '@import "sub/dep.css";',
      'D:/snips/sub/dep.css': '.a{color:red}',
    })
    const result = await analyzeSnippetEntry('D:\\snips', 'main.css', ports, 'D:/snips')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.importPaths).toEqual(['D:/snips/sub/dep.css'])
    }
  })
})
