// 宿主侧链接/图片目标分类契约（工单 #10，#556 增补显式绝对路径分类）：
// webview 只上报原始 href/src，宿主负责 URI 解析与路径拼接——分类器是
// 该职责的纯逻辑核心，必须先于执行层被钉死：
// - scheme 白名单：仅 http/https 外开，其余带 scheme 的一律拦截（file://、
//   javascript:、vscode-asset:、mailto:、协议相对 //）
// - 工作区路径：基于当前文档所在目录解析，不得越过资源根（工作区文件夹
//   根；无工作区时为文档目录）；Windows 盘符路径只在 Windows 宿主生效，
//   远程（POSIX 宿主）不得把 Windows 路径当工作区路径（两类 URI 不混用）
// - 显式绝对路径（#556，ADR-0018）：Windows 宿主盘符形态与 POSIX 宿主
//   根路径归 absolute 分类（携带候选/fsPath 与 fragment，允许跨根与
//   工作区外目标）；Win32 怪 basename（ADS/尾随点）拦截继续适用；
//   UNC 与 POSIX 宿主上的盘符维持拦截
// - 相对路径、空格、中文与 %编码（%20/%E5…）都有明确期望
// - 无扩展名的文档链接按「精确优先，其次补 .md」给候选（#11 双链同语义
//   的便捷形态）
// - #160 锚点 fragment：CommonMark 语义首个 `#` 拆分——其前为路径、其后
//   整段为 fragment（结构化保留供定位）；仅锚点（#frag）解析为本文件
//   锚点目标；外部 scheme 的 `#` 是网页锚点语义，不接管（照旧外开）
import { describe, it, expect } from 'vitest'
import {
  appendImageVersionStamp,
  classifyImageTarget,
  classifyLinkTarget,
  type LinkContext,
} from '../../src/host/linkTarget'

const WIN: LinkContext = {
  docDir: 'd:\\notes\\子目录',
  rootDir: 'd:\\notes',
  isWindowsHost: true,
}

const POSIX: LinkContext = {
  docDir: '/home/u/notes/sub',
  rootDir: '/home/u/notes',
  isWindowsHost: false,
}

describe('scheme 白名单：外部链接', () => {
  it('http/https（大小写不敏感）归类为 external，保留原 URL', () => {
    expect(classifyLinkTarget('https://example.com/a?b=1#frag', WIN)).toEqual({
      kind: 'external',
      url: 'https://example.com/a?b=1#frag',
    })
    expect(classifyLinkTarget('http://example.com', WIN)).toEqual({
      kind: 'external',
      url: 'http://example.com',
    })
    expect(classifyLinkTarget('HTTPS://EXAMPLE.COM/X', POSIX)).toEqual({
      kind: 'external',
      url: 'HTTPS://EXAMPLE.COM/X',
    })
  })

  it('file:// 与危险/怪异 scheme 一律拦截并给出 scheme 名', () => {
    for (const href of [
      'file:///d:/notes/a.md',
      'file://HOST/share/a.md',
      'javascript:alert(1)',
      'vscode-asset://x/y',
      'vscode-webview-resource://x',
      'mailto:a@b.c',
      'ftp://files.example.com/a',
      'data:text/html,<script>',
    ]) {
      const r = classifyLinkTarget(href, WIN)
      expect(r.kind).toBe('blocked')
      expect(r.kind === 'blocked' && r.reason).toBe('scheme')
    }
    const file = classifyLinkTarget('file:///d:/notes/a.md', WIN)
    expect(file.kind === 'blocked' && file.scheme).toBe('file')
    const js = classifyLinkTarget('javascript:alert(1)', WIN)
    expect(js.kind === 'blocked' && js.scheme).toBe('javascript')
  })

  it('协议相对 //example.com 与空白 href 拦截', () => {
    const proto = classifyLinkTarget('//example.com/x', WIN)
    expect(proto.kind === 'blocked' && proto.reason).toBe('scheme')
    expect(classifyLinkTarget('', WIN).kind).toBe('blocked')
    expect(classifyLinkTarget('   ', WIN).kind).toBe('blocked')
  })

  it('仅锚点（#frag）解析为本文件锚点目标（#160 页内跳转）', () => {
    const r = classifyLinkTarget('#标题锚点', WIN)
    expect(r).toEqual({ kind: 'anchor', fragment: '标题锚点' })
    // %编码形态与原文解析到同一 fragment（与路径同口径）
    const enc = classifyLinkTarget('#%E6%A0%87%E9%A2%98', WIN)
    expect(enc).toEqual({ kind: 'anchor', fragment: '标题' })
    // 裸 #（空锚点）维持拦截：无可定位目标
    const bare = classifyLinkTarget('#', WIN)
    expect(bare.kind).toBe('blocked')
    expect(bare.kind === 'blocked' && bare.reason).toBe('empty')
  })
})

describe('工作区相对路径解析（基于当前文档所在目录）', () => {
  it('相对路径 + 中文 + 空格：原样与 %编码两种写法解析到同一目标', () => {
    const raw = classifyLinkTarget('./目标 二.md', WIN)
    expect(raw).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\目标 二.md'],
      fragment: null,
    })
    const encoded = classifyLinkTarget('.%2F%E7%9B%AE%E6%A0%87%20%E4%BA%8C.md', WIN)
    expect(encoded).toEqual(raw)
  })

  it('../ 上行仍在资源根内则允许，越出资源根则拦截（不静默越界）', () => {
    const up = classifyLinkTarget('../上层文档.md', WIN)
    expect(up).toEqual({ kind: 'doc', candidates: ['d:\\notes\\上层文档.md'], fragment: null })
    const escape = classifyLinkTarget('../../越界文档.md', WIN)
    expect(escape.kind).toBe('blocked')
    expect(escape.kind === 'blocked' && escape.reason).toBe('escape')
  })

  it('首个 # 拆分：路径照常解析，fragment 结构化保留（#160）', () => {
    const r = classifyLinkTarget('./a.md#section', WIN)
    expect(r).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\a.md'],
      fragment: 'section',
    })
    const q = classifyLinkTarget('./a.md?x=1', WIN)
    expect(q).toEqual({ kind: 'doc', candidates: ['d:\\notes\\子目录\\a.md'], fragment: null })
    // query 在 # 之前：路径剥 query、fragment 为其后整段
    const qf = classifyLinkTarget('./a.md?x=1#小节', WIN)
    expect(qf).toEqual({ kind: 'doc', candidates: ['d:\\notes\\子目录\\a.md'], fragment: '小节' })
    // # 在 query 之前：首个 # 后整段为 fragment（fragment 内 ? 不剥）
    const fq = classifyLinkTarget('./a.md#小节?x=1', WIN)
    expect(fq).toEqual({ kind: 'doc', candidates: ['d:\\notes\\子目录\\a.md'], fragment: '小节?x=1' })
  })

  it('无扩展名：候选为「精确路径，其次补 .md」', () => {
    const r = classifyLinkTarget('./隔壁笔记', WIN)
    expect(r).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\隔壁笔记', 'd:\\notes\\子目录\\隔壁笔记.md'],
      fragment: null,
    })
    // 已有扩展名不追加
    const png = classifyLinkTarget('./图.png', WIN)
    expect(png).toEqual({ kind: 'doc', candidates: ['d:\\notes\\子目录\\图.png'], fragment: null })
  })

  it('#152 宽松形态的字面目标（含空格路径/带引号整段目标）按普通路径分类', () => {
    // 渲染层放行后 webview 上报字面目标：分类层不得丢空格或拆引号——
    // 引号组合形态的目标是 `a b "标题"` 整段（宽松形态学口径），文件不存在
    // 由 vscode 层探测后给 not-found 反馈
    expect(classifyLinkTarget('./子 目录/目标 文档.md', WIN)).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\子 目录\\目标 文档.md'],
      fragment: null,
    })
    const quoted = classifyLinkTarget('a b "标题"', WIN)
    expect(quoted).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\a b "标题"', 'd:\\notes\\子目录\\a b "标题".md'],
      fragment: null,
    })
  })

  it('POSIX 宿主：相对路径与 UTF-8 命名解析正确', () => {
    const r = classifyLinkTarget('./assets/图 片说明.md', POSIX)
    expect(r).toEqual({
      kind: 'doc',
      candidates: ['/home/u/notes/sub/assets/图 片说明.md'],
      fragment: null,
    })
    const enc = classifyLinkTarget('./assets/%E5%9B%BE%20%E7%89%87%E8%AF%B4%E6%98%8E.md', POSIX)
    expect(enc).toEqual(r)
  })

  it('POSIX 宿主：绝对路径归 absolute 分类（#556 允许根外目标）', () => {
    const inside = classifyLinkTarget('/home/u/notes/a.md', POSIX)
    expect(inside).toEqual({ kind: 'absolute', candidates: ['/home/u/notes/a.md'], fragment: null })
    const outside = classifyLinkTarget('/etc/目标.md', POSIX)
    expect(outside).toEqual({ kind: 'absolute', candidates: ['/etc/目标.md'], fragment: null })
  })
})

describe('Windows 与远程（POSIX 宿主）不混用', () => {
  it('Windows 宿主：反斜杠分隔符归一；盘符绝对路径归 absolute（#556）', () => {
    const bs = classifyLinkTarget('嵌套\\深层.md', WIN)
    expect(bs).toEqual({ kind: 'doc', candidates: ['d:\\notes\\子目录\\嵌套\\深层.md'], fragment: null })
    // 根内盘符路径也走 absolute（独立解析语义，候选即该路径）
    const drive = classifyLinkTarget('d:\\notes\\绝对.md', WIN)
    expect(drive).toEqual({ kind: 'absolute', candidates: ['d:\\notes\\绝对.md'], fragment: null })
    // 根外/跨盘绝对路径不再拦截（允许工作区外目标）
    const driveOut = classifyLinkTarget('e:\\别的盘\\x.md', WIN)
    expect(driveOut).toEqual({ kind: 'absolute', candidates: ['e:\\别的盘\\x.md'], fragment: null })
    // UNC 路径不在资源根内：维持拦截
    const unc = classifyLinkTarget('\\\\server\\share\\a.md', WIN)
    expect(unc.kind === 'blocked' && unc.reason).toBe('escape')
  })

  it('Windows 宿主：POSIX 风格根路径按资源根所在盘解析（盘内根相对）', () => {
    const r = classifyLinkTarget('/notes/根相对.md', WIN)
    expect(r).toEqual({ kind: 'doc', candidates: ['d:\\notes\\根相对.md'], fragment: null })
  })

  it('POSIX 宿主（远程）：Windows 盘符路径拦截，不当作工作区路径', () => {
    const r = classifyLinkTarget('d:\\notes\\a.md', POSIX)
    expect(r.kind).toBe('blocked')
    expect(r.kind === 'blocked' && r.reason).toBe('windows-drive-on-posix')
    // 大写盘符同样拦截
    const up = classifyLinkTarget('C:/x.md', POSIX)
    expect(up.kind === 'blocked' && up.reason).toBe('windows-drive-on-posix')
  })

  it('单字母 scheme 不误判：Windows 宿主上 c:\\x.md 是盘符而非 scheme', () => {
    // 盘符路径归 absolute 分类（#556 独立解析语义，而非被当 scheme 拦截）
    const inside = classifyLinkTarget('d:\\notes\\盘符.md', WIN)
    expect(inside.kind).toBe('absolute')
    // 根外盘符路径同样归 absolute（不再按越界拦截）
    const other = classifyLinkTarget('c:\\notes\\a.md', WIN)
    expect(other).toEqual({ kind: 'absolute', candidates: ['c:\\notes\\a.md'], fragment: null })
  })
})

describe('#556 显式绝对路径目标（跨根与工作区外，ADR-0018）', () => {
  it('Windows 盘符：absolute 分类携带候选与 fragment；%编码与字面原文同目标', () => {
    const raw = classifyLinkTarget('e:\\外部库\\资料 目标.md#小节', WIN)
    expect(raw).toEqual({
      kind: 'absolute',
      candidates: ['e:\\外部库\\资料 目标.md'],
      fragment: '小节',
    })
    const enc = classifyLinkTarget('e:/外部库/%E8%B5%84%E6%96%99%20%E7%9B%AE%E6%A0%87.md', WIN)
    expect(enc).toEqual({
      kind: 'absolute',
      candidates: ['e:\\外部库\\资料 目标.md'],
      fragment: null,
    })
  })

  it('Windows 盘符：无扩展名候选补 .md（与相对路径同规则）', () => {
    const r = classifyLinkTarget('e:/外部库/笔记', WIN)
    expect(r).toEqual({
      kind: 'absolute',
      candidates: ['e:\\外部库\\笔记', 'e:\\外部库\\笔记.md'],
      fragment: null,
    })
  })

  it('盘符路径的 Win32 怪 basename（ADS/尾随点）继续拦截：不因 absolute 放行', () => {
    // basename 含 ':'（NTFS 备用数据流）与尾随 '.'/空格：两通道同口径拦截
    for (const href of ['c:\\外部\\note.md::$DATA', 'c:\\外部\\note.', 'c:\\外部\\note.md ']) {
      const t = classifyLinkTarget(href, WIN)
      expect(t).toMatchObject({ kind: 'blocked', reason: 'escape' })
      const img = classifyImageTarget(href, WIN)
      expect(img).toMatchObject({ kind: 'blocked' })
    }
  })

  it('图片：Windows 盘符与 POSIX 根路径归 absolute fsPath（单候选，不补 .md）', () => {
    expect(classifyImageTarget('f:\\assets\\图 片.png', WIN)).toEqual({
      kind: 'absolute',
      fsPath: 'f:\\assets\\图 片.png',
    })
    expect(classifyImageTarget('/srv/assets/%E5%9B%BE.png', POSIX)).toEqual({
      kind: 'absolute',
      fsPath: '/srv/assets/图.png',
    })
    // 无扩展名图片语义单候选
    expect(classifyImageTarget('f:/assets/shot', WIN)).toEqual({
      kind: 'absolute',
      fsPath: 'f:\\assets\\shot',
    })
  })
})

describe('Windows 宿主的 Win32 规范化怪异形态（NTFS ADS 等）', () => {
  // basename 含 ':'（如 note.md::$DATA）会被当作 NTFS 备用数据流读取，
  // 尾随 '.'/空格 会被 Win32 规范化剥除——两者都不指向用户可见文件，
  // 一律拦截（POSIX 宿主上 ':' 是合法文件名字符，不适用该过滤）
  it('ADS 形态（basename 含冒号）拦截：链接与图片通道同口径', () => {
    for (const href of ['note.md::$DATA', 'note.md:stream', '子目录/记:怪']) {
      const t = classifyLinkTarget(href, WIN)
      expect(t).toMatchObject({ kind: 'blocked', reason: 'escape' })
      const img = classifyImageTarget(href, WIN)
      expect(img).toMatchObject({ kind: 'blocked' })
    }
  })

  it('basename 尾随点或空格拦截（Win32 规范化会剥除）', () => {
    expect(classifyLinkTarget('note.md.', WIN)).toMatchObject({ kind: 'blocked', reason: 'escape' })
    expect(classifyLinkTarget('note.md ', WIN)).toMatchObject({ kind: 'blocked', reason: 'escape' })
    // 点+tab 组合：tab 属 trim 家族空白，剥除后尾随点同样会被 Win32 规范化
    expect(classifyLinkTarget('note.md.\t', WIN)).toMatchObject({ kind: 'blocked', reason: 'escape' })
    expect(classifyLinkTarget('note.md\t', WIN)).toMatchObject({ kind: 'blocked', reason: 'escape' })
  })

  it('POSIX 宿主不适用该过滤（冒号/尾随点是合法文件名）', () => {
    expect(classifyLinkTarget('a:b.md', POSIX)).toMatchObject({ kind: 'doc' })
    expect(classifyLinkTarget('weird.', POSIX)).toMatchObject({ kind: 'doc' })
  })
})

describe('图片目标分类（classifyImageTarget）', () => {
  it('工作区内相对图片解析为待读文件路径（空格/中文/%编码）', () => {
    const raw = classifyImageTarget('./assets/图 片.png', WIN)
    expect(raw).toEqual({ kind: 'workspace', fsPath: 'd:\\notes\\子目录\\assets\\图 片.png' })
    const enc = classifyImageTarget('./assets/%E5%9B%BE%20%E7%89%87.png', WIN)
    expect(enc).toEqual(raw)
  })

  it('危险 scheme 与远程 URI 不在此通道放行（webview 只应上报工作区相对 src）', () => {
    for (const src of [
      'file:///d:/x.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'https://cdn.example.com/x.png',
    ]) {
      const r = classifyImageTarget(src, WIN)
      expect(r.kind).toBe('blocked')
      expect(r.kind === 'blocked' && r.reason).toBe('scheme')
    }
  })

  it('越出资源根拦截；POSIX 宿主上 Windows 盘符拦截', () => {
    const esc = classifyImageTarget('../../outside.png', WIN)
    expect(esc.kind === 'blocked' && esc.reason).toBe('escape')
    const winOnPosix = classifyImageTarget('d:\\x.png', POSIX)
    expect(winOnPosix.kind === 'blocked' && winOnPosix.reason).toBe('windows-drive-on-posix')
  })

  it('图片 src 的 #frag 维持拦截（图片无锚点语义，#160 不放行图片通道）', () => {
    const img = classifyImageTarget('#frag', WIN)
    expect(img.kind === 'blocked')
    expect(img.kind === 'blocked' && img.reason).toBe('empty')
  })
})

describe('#160 锚点 fragment：含空格路径矩阵与接管边界', () => {
  // 用户点名的含空格矩阵：宽松链接（live 字面上报）与 %编码（阅读
  // normalizeLink 后上报）两种写法必须解析到同一目标与 fragment——
  // 宿主拆分在 classifyLinkTarget，与 webview 上报通道无关
  it('含空格路径 + 锚点：./my file.md#标题（原文与 %20/%E5 编码同目标）', () => {
    const raw = classifyLinkTarget('./my file.md#标题', WIN)
    expect(raw).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\my file.md'],
      fragment: '标题',
    })
    const enc = classifyLinkTarget('./my%20file.md#%E6%A0%87%E9%A2%98', WIN)
    expect(enc).toEqual(raw)
  })

  it('含空格无扩展名路径 + 锚点：./my file#标题（候选补 .md）', () => {
    const raw = classifyLinkTarget('./my file#标题', WIN)
    expect(raw).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\my file', 'd:\\notes\\子目录\\my file.md'],
      fragment: '标题',
    })
    const enc = classifyLinkTarget('./my%20file#%E6%A0%87%E9%A2%98', WIN)
    expect(enc).toEqual(raw)
  })

  it('含空格路径 + 锚点（POSIX 宿主）同语义', () => {
    const raw = classifyLinkTarget('./my file.md#标题', POSIX)
    expect(raw).toEqual({
      kind: 'doc',
      candidates: ['/home/u/notes/sub/my file.md'],
      fragment: '标题',
    })
  })

  it('路径本身含 #：按 CommonMark 拆为 ./a + fragment b.md（已知边界）', () => {
    const r = classifyLinkTarget('./a#b.md', WIN)
    expect(r).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\a', 'd:\\notes\\子目录\\a.md'],
      fragment: 'b.md',
    })
  })

  it('锚点里的空格照常保留（宽松形态字面上报），与标题匹配的空白折叠口径衔接', () => {
    const r = classifyLinkTarget('./my file.md#小 节', WIN)
    expect(r).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\my file.md'],
      fragment: '小 节',
    })
  })

  it('外部 scheme 的 # 不接管：URL 原样外开（网页锚点语义）', () => {
    expect(classifyLinkTarget('https://example.com/a#frag', WIN)).toEqual({
      kind: 'external',
      url: 'https://example.com/a#frag',
    })
    expect(classifyLinkTarget('http://example.com/x#%E6%A0%87%E9%A2%98', POSIX)).toEqual({
      kind: 'external',
      url: 'http://example.com/x#%E6%A0%87%E9%A2%98',
    })
    // 非白名单 scheme 照旧拦截（fragment 不改变 scheme 判定）
    const blocked = classifyLinkTarget('mailto:a@b.c#frag', WIN)
    expect(blocked.kind === 'blocked' && blocked.reason).toBe('scheme')
  })
})

describe('#534 普通链接尾部行号：本地路径剥 :正整数（早于 ADS 拦截）', () => {
  // 规格 addon-navigation.md §5.1：仅普通 Markdown 链接的本地路径段支持
  // `:正整数` 行号后缀；剥离必须早于 Win32 ADS/怪异 basename 拦截
  //（note.md:103 的 basename 含 ':'，不先剥会被当 NTFS 备用数据流拦截）。
  // 图片通道无行号语义，不受剥离影响。
  it('md 与非 md 目标剥尾部行号并携带 line（Windows 宿主不再被 ADS 拦截）', () => {
    expect(classifyLinkTarget('note.md:103', WIN)).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\note.md'],
      fragment: null,
      line: 103,
    })
    expect(classifyLinkTarget('file.ts:103', WIN)).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\file.ts'],
      fragment: null,
      line: 103,
    })
    expect(classifyLinkTarget('file.ts:1', WIN)).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\file.ts'],
      fragment: null,
      line: 1,
    })
  })

  it('POSIX 宿主：相对路径与根路径同样剥行号', () => {
    expect(classifyLinkTarget('./deep/file.md:42', POSIX)).toEqual({
      kind: 'doc',
      candidates: ['/home/u/notes/sub/deep/file.md'],
      fragment: null,
      line: 42,
    })
    expect(classifyLinkTarget('/etc/目标.md:7', POSIX)).toEqual({
      kind: 'absolute',
      candidates: ['/etc/目标.md'],
      fragment: null,
      line: 7,
    })
  })

  it('Windows 盘符绝对路径剥行号归 absolute（盘符边界保持）', () => {
    expect(classifyLinkTarget('c:\\外部\\note.md:103', WIN)).toEqual({
      kind: 'absolute',
      candidates: ['c:\\外部\\note.md'],
      fragment: null,
      line: 103,
    })
    expect(classifyLinkTarget('e:/外部库/资料 目标.md:5', WIN)).toEqual({
      kind: 'absolute',
      candidates: ['e:\\外部库\\资料 目标.md'],
      fragment: null,
      line: 5,
    })
  })

  it('空格宽松路径与 %编码：剥行号后两种写法解析到同一目标', () => {
    const raw = classifyLinkTarget('./目标 二.md:103', WIN)
    expect(raw).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\目标 二.md'],
      fragment: null,
      line: 103,
    })
    const enc = classifyLinkTarget('.%2F%E7%9B%AE%E6%A0%87%20%E4%BA%8C.md:103', WIN)
    expect(enc).toEqual(raw)
  })

  it('无扩展名目标剥行号后沿既有候选规则补 .md', () => {
    expect(classifyLinkTarget('./隔壁笔记:12', WIN)).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\隔壁笔记', 'd:\\notes\\子目录\\隔壁笔记.md'],
      fragment: null,
      line: 12,
    })
  })

  it('query 与行号共存：行号不从 query 提取，query 照常剥除', () => {
    expect(classifyLinkTarget('note.md:103?x=1', WIN)).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\note.md'],
      fragment: null,
      line: 103,
    })
    // 行号后缀必须紧跟路径段：query 里写行号不构成定位
    expect(classifyLinkTarget('note.md?line=103', WIN)).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\note.md'],
      fragment: null,
    })
  })

  it('前导零行号按值语义剥（与 refText isPositiveDecimal 同口径）', () => {
    expect(classifyLinkTarget('note.md:0103', WIN)).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\note.md'],
      fragment: null,
      line: 103,
    })
  })

  it('混合定位（行号 + 非空 fragment）整次语法非法：blocked 且不误作标题', () => {
    for (const ctx of [WIN, POSIX]) {
      const r = classifyLinkTarget('note.md:20#第二章', ctx)
      expect(r).toMatchObject({ kind: 'blocked', reason: 'line-anchor-conflict' })
      const blk = classifyLinkTarget('note.md:20#^blkid', ctx)
      expect(blk).toMatchObject({ kind: 'blocked', reason: 'line-anchor-conflict' })
    }
  })

  it('行号 + 空 fragment（note.md:103#）等价纯行号定位', () => {
    expect(classifyLinkTarget('note.md:103#', WIN)).toEqual({
      kind: 'doc',
      candidates: ['d:\\notes\\子目录\\note.md'],
      fragment: null,
      line: 103,
    })
  })

  it(':0 / 全零 / 负数 / 非数字不构成行号：保持既有分类不宽容修正', () => {
    // Windows 宿主：basename 含 ':' 仍按 ADS 口径拦截
    for (const href of ['note.md:0', 'note.md:00', 'note.md:-5', 'note.md:abc', 'note.md:1x']) {
      const r = classifyLinkTarget(href, WIN)
      expect(r).toMatchObject({ kind: 'blocked', reason: 'escape' })
    }
    // POSIX 宿主：这些是合法文件名字符，按原文件名分类（候选含原文）
    expect(classifyLinkTarget('note.md:0', POSIX)).toEqual({
      kind: 'doc',
      candidates: ['/home/u/notes/sub/note.md:0'],
      fragment: null,
    })
    expect(classifyLinkTarget('note.md:abc', POSIX)).toEqual({
      kind: 'doc',
      candidates: ['/home/u/notes/sub/note.md:abc'],
      fragment: null,
    })
  })

  it('a:b.md 等单字母 scheme 形态不受影响（尾部非纯数字不剥）', () => {
    expect(classifyLinkTarget('a:b.md', WIN)).toMatchObject({ kind: 'blocked', reason: 'escape' })
    expect(classifyLinkTarget('a:b.md', POSIX)).toMatchObject({ kind: 'doc' })
    // a:103 剥为文件 a 第 103 行（无扩展名候选补 .md）
    expect(classifyLinkTarget('a:103', POSIX)).toEqual({
      kind: 'doc',
      candidates: ['/home/u/notes/sub/a', '/home/u/notes/sub/a.md'],
      fragment: null,
      line: 103,
    })
  })

  it('外链协议与端口不受影响：https://host:443 原样 external', () => {
    expect(classifyLinkTarget('https://host.example:443/path', WIN)).toEqual({
      kind: 'external',
      url: 'https://host.example:443/path',
    })
    expect(classifyLinkTarget('https://host.example:443', POSIX)).toEqual({
      kind: 'external',
      url: 'https://host.example:443',
    })
    // 真白名单外的 scheme 照旧拦截（mailto:103 不剥端口数字）
    const mailto = classifyLinkTarget('mailto:a@b.c:103', WIN)
    expect(mailto).toMatchObject({ kind: 'blocked', reason: 'scheme' })
  })

  it('页内锚点不受行号剥离影响（#frag 原样）', () => {
    expect(classifyLinkTarget('#sec:103', WIN)).toEqual({ kind: 'anchor', fragment: 'sec:103' })
    expect(classifyLinkTarget('#第103节', POSIX)).toEqual({ kind: 'anchor', fragment: '第103节' })
  })

  it('尾随空白宽容：note.md:103␠ 剥行号后保留尾空白（Windows 仍按尾空白拦截）', () => {
    // 宽松链接 <note.md:103 > 的字面目标：行号后尾空白不属行号，剥离
    // 容忍；剥后尾空白保留——Windows 的 Win32 规范化拦截口径不变
    const r = classifyLinkTarget('note.md:103 ', WIN)
    expect(r).toMatchObject({ kind: 'blocked', reason: 'escape' })
    const p = classifyLinkTarget('note.md:103 ', POSIX)
    expect(p).toEqual({
      kind: 'doc',
      candidates: ['/home/u/notes/sub/note.md'],
      fragment: null,
      line: 103,
    })
  })

  it('图片通道不剥行号（photo.png:103 保持既有 ADS 拦截/文件名分类）', () => {
    expect(classifyImageTarget('photo.png:103', WIN)).toMatchObject({ kind: 'blocked' })
    expect(classifyImageTarget('photo.png:103', POSIX)).toEqual({
      kind: 'workspace',
      fsPath: '/home/u/notes/sub/photo.png:103',
    })
  })
})

describe('#208 图片 webview URI 的资源代次戳（手动刷新缓存击穿）', () => {
  it('代次 ≥ 1 时追加 ?v=<代次>（CSS 片段 ?v= 同式）', () => {
    expect(appendImageVersionStamp('vscode-webview://res/a.png', 1)).toBe(
      'vscode-webview://res/a.png?v=1',
    )
    expect(appendImageVersionStamp('vscode-webview://res/sub/b%20c.png', 12)).toBe(
      'vscode-webview://res/sub/b%20c.png?v=12',
    )
  })

  it('代次 0（未刷新初值）不戳：URI 形态与现状一致', () => {
    expect(appendImageVersionStamp('vscode-webview://res/a.png', 0)).toBe(
      'vscode-webview://res/a.png',
    )
  })
})
