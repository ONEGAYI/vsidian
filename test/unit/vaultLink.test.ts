// 根内相对 + 显式绝对 + 短名补查的目标解析契约（#196 确立根内相对语义，
// #556 增补绝对路径与短名补查，ADR-0018）：
// src/shared/vaultLink.ts 是双链与普通链接/图片共用的目标解析单一事实源，
// 本文件钉死：
// - 目标一律先按来源文档目录（docDir）相对解析：[[设计]] = docDir/设计(.md)，
//   相对候选优先；嵌套根按最具体根划界（rootDir 由调用方注入最具体根）
// - 显式绝对路径（#556）：Windows 盘符形态（反斜杠先归一）与 POSIX 宿主
//   根路径独立解析为 absolute——不接 docDir、不受 rootDir 边界、不做短名
//   补查、无工作区也成立；UNC 维持 escape；POSIX 宿主上的盘符是普通
//   文件名（跨宿主盘符拦截在 linkTarget 层）
// - 短名补查（#556）：相对候选全未命中且路径仅含文件名时，经注入端口查
//   所属根内唯一同名 Markdown——唯一且清单完整 target、多候选 ambiguous、
//   唯一但清单不完整 pending、零候选 not-found；端口不注入则补查不存在
//   （行为与无补查语义逐字节一致）；仅 Markdown 语义触发（显式 .md 或
//   省略扩展名），非 Markdown 不跨目录补查
// - [[项目甲/设计]] 明确子路径；[[../设计]] 根内上行照常；越出所属根 escape
// - 扩展名语义：显式扩展名单候选（不产生 x.pdf.md）；无扩展名 implicitMd
//   时 [精确, 精确+.md]（精确优先）；图片语义单候选
// - 分隔符：Windows 宿主反斜杠当分隔符归一；POSIX 宿主上反斜杠是普通
//   文件名字符（远程语义不转换）
// - 大小写语义由 exists 端口的宿主文件系统裁决（NTFS 不敏感 / POSIX
//  严格——本模块不折叠）；Windows 不敏感命中后端口返回磁盘真实大小写
//   路径，target 取归正形态（防面板/文档身份漂移）
// - resolve 层：no-workspace（相对目标）、空目标 not-found、escape 不触
//   探测端口、候选按序取首个存在者
// 迁移自 test/unit/wikilinkTarget.test.ts 的 #196 红灯契约（实现落地后
// wikilinkTarget 回归锚点定位单一职责）。
import { describe, it, expect } from 'vitest'
import {
  isVaultPathInsideRoot,
  planVaultLinkPath,
  resolveVaultLinkFile,
  type VaultLinkResolveContext,
} from '../../src/shared/vaultLink'

const WIN: VaultLinkResolveContext = {
  docDir: 'd:\\notes\\子目录',
  rootDir: 'd:\\notes',
  isWindowsHost: true,
  hasWorkspace: true,
}

const POSIX: VaultLinkResolveContext = {
  docDir: '/home/u/notes/sub',
  rootDir: '/home/u/notes',
  isWindowsHost: false,
  hasWorkspace: true,
}

/** 内存文件系统存在性端口（hostFsPath 形态的路径集合——命中原样返回，
 *  即 POSIX 严格语义；大小写归正语义另行注入平台语义端口） */
function existsOf(...fsPaths: string[]) {
  const set = new Set(fsPaths)
  return (p: string): string | null => (set.has(p) ? p : null)
}

describe('planVaultLinkPath：候选规划（纯路径计算，来源目录基准）', () => {
  it('同目录短名：[[设计]] 规划到 docDir/设计（+补 .md 候选，精确优先）', () => {
    expect(planVaultLinkPath('设计', WIN)).toEqual({
      kind: 'inside',
      candidates: ['d:\\notes\\子目录\\设计', 'd:\\notes\\子目录\\设计.md'],
    })
  })

  it('明确子路径：[[项目甲/设计]] 规划到 docDir 下的子路径', () => {
    expect(planVaultLinkPath('项目甲/设计', WIN)).toEqual({
      kind: 'inside',
      candidates: ['d:\\notes\\子目录\\项目甲\\设计', 'd:\\notes\\子目录\\项目甲\\设计.md'],
    })
  })

  it('显式 .md 扩展名：单候选精确路径（不产生 .md.md）', () => {
    expect(planVaultLinkPath('笔记.md', WIN)).toEqual({
      kind: 'inside',
      candidates: ['d:\\notes\\子目录\\笔记.md'],
    })
  })

  it('显式非 Markdown 扩展名（.pdf/.png）：单候选，不补 .md（图片/文件引用语义）', () => {
    expect(planVaultLinkPath('手册.pdf', WIN)).toEqual({
      kind: 'inside',
      candidates: ['d:\\notes\\子目录\\手册.pdf'],
    })
    expect(planVaultLinkPath('图 一.png', WIN, { implicitMd: false })).toEqual({
      kind: 'inside',
      candidates: ['d:\\notes\\子目录\\图 一.png'],
    })
  })

  it('无扩展名 implicitMd=false（图片通道）：单候选不补 .md', () => {
    expect(planVaultLinkPath('shot', WIN, { implicitMd: false })).toEqual({
      kind: 'inside',
      candidates: ['d:\\notes\\子目录\\shot'],
    })
  })

  it('带点的文件名 stem（v1.2）按「有扩展名」单候选处理（与现行口径一致）', () => {
    expect(planVaultLinkPath('v1.2', WIN)).toEqual({
      kind: 'inside',
      candidates: ['d:\\notes\\子目录\\v1.2'],
    })
  })

  it('./ 与 ../ 前缀按路径语义归一；根内 ../ 上行允许', () => {
    expect(planVaultLinkPath('./隔壁笔记', WIN)).toEqual({
      kind: 'inside',
      candidates: ['d:\\notes\\子目录\\隔壁笔记', 'd:\\notes\\子目录\\隔壁笔记.md'],
    })
    expect(planVaultLinkPath('../设计', WIN)).toEqual({
      kind: 'inside',
      candidates: ['d:\\notes\\设计', 'd:\\notes\\设计.md'],
    })
  })

  it('越出所属根（../../）：escape（路径不得静默越界）', () => {
    expect(planVaultLinkPath('../../设计', WIN)).toEqual({
      kind: 'escape',
      detail: '../../设计',
    })
    expect(planVaultLinkPath('../../设计', POSIX)).toEqual({ kind: 'escape', detail: '../../设计' })
  })

  it('绝对路径（#556）：Windows 盘符形态独立解析为 absolute（不接 docDir、不受根边界）', () => {
    // 反斜杠先归一再判定；显式 .md 扩展名单候选
    expect(planVaultLinkPath('c:\\别的\\目标.md', WIN)).toEqual({
      kind: 'absolute',
      candidates: ['c:\\别的\\目标.md'],
    })
    // 无扩展名补 .md 候选（与 inside 同规则，精确优先）
    expect(planVaultLinkPath('e:/其他盘/笔记', WIN)).toEqual({
      kind: 'absolute',
      candidates: ['e:\\其他盘\\笔记', 'e:\\其他盘\\笔记.md'],
    })
    // implicitMd=false（图片等二进制语义）：单候选不补 .md
    expect(planVaultLinkPath('e:/其他盘/图', WIN, { implicitMd: false })).toEqual({
      kind: 'absolute',
      candidates: ['e:\\其他盘\\图'],
    })
  })

  it('绝对路径（#556）：POSIX 宿主根路径独立解析为 absolute（不限于根内）', () => {
    expect(planVaultLinkPath('/etc/目标.md', POSIX)).toEqual({
      kind: 'absolute',
      candidates: ['/etc/目标.md'],
    })
    expect(planVaultLinkPath('/srv/笔记', POSIX)).toEqual({
      kind: 'absolute',
      candidates: ['/srv/笔记', '/srv/笔记.md'],
    })
  })

  it('UNC 形态维持 escape：不新增 absolute 解析（越出本地根即拦截）', () => {
    expect(planVaultLinkPath('\\\\server\\share\\目标.md', WIN)).toEqual({
      kind: 'escape',
      detail: '\\\\server\\share\\目标.md',
    })
  })

  it('UNC 根宿主：根内路径维持 inside（UNC 拦截口径不误伤 UNC 根内目标）', () => {
    const UNC: VaultLinkResolveContext = {
      docDir: '\\\\server\\share\\notes\\sub',
      rootDir: '\\\\server\\share\\notes',
      isWindowsHost: true,
      hasWorkspace: true,
    }
    expect(planVaultLinkPath('..\\目标.md', UNC)).toEqual({
      kind: 'inside',
      candidates: ['\\\\server\\share\\notes\\目标.md'],
    })
  })

  it('POSIX 宿主上的盘符形态维持相对文件名语义（跨宿主盘符拦截在 linkTarget 层）', () => {
    expect(planVaultLinkPath('c:/x.md', POSIX)).toEqual({
      kind: 'inside',
      candidates: ['/home/u/notes/sub/c:/x.md'],
    })
  })

  it('`..foo.md` 是同级合法文件名：不误判越界（relative 精确判定）', () => {
    expect(planVaultLinkPath('..特殊.md', WIN)).toEqual({
      kind: 'inside',
      candidates: ['d:\\notes\\子目录\\..特殊.md'],
    })
  })

  it('空路径：escape（无可定位目标，与普通链接 blocked(escape) 同口径）', () => {
    expect(planVaultLinkPath('', WIN)).toEqual({ kind: 'escape', detail: '' })
    expect(planVaultLinkPath('   ', WIN)).toEqual({ kind: 'escape', detail: '   ' })
  })

  it('Windows 宿主：反斜杠按分隔符归一解析', () => {
    expect(planVaultLinkPath('项目甲\\设计', WIN)).toEqual({
      kind: 'inside',
      candidates: ['d:\\notes\\子目录\\项目甲\\设计', 'd:\\notes\\子目录\\项目甲\\设计.md'],
    })
  })

  it('POSIX 宿主：反斜杠是普通文件名字符（不是分隔符）', () => {
    expect(planVaultLinkPath('a\\b', POSIX)).toEqual({
      kind: 'inside',
      candidates: ['/home/u/notes/sub/a\\b', '/home/u/notes/sub/a\\b.md'],
    })
  })

  it('POSIX 宿主路径形态（远程语义）', () => {
    expect(planVaultLinkPath('项目甲/设计', POSIX)).toEqual({
      kind: 'inside',
      candidates: ['/home/u/notes/sub/项目甲/设计', '/home/u/notes/sub/项目甲/设计.md'],
    })
  })

  it('文档在根目录时（docDir = rootDir）：短名即根内路径', () => {
    const rootCtx: VaultLinkResolveContext = { ...WIN, docDir: WIN.rootDir }
    expect(planVaultLinkPath('根目标', rootCtx)).toEqual({
      kind: 'inside',
      candidates: ['d:\\notes\\根目标', 'd:\\notes\\根目标.md'],
    })
  })

  it('嵌套根按最具体根划界：越出最具体根即 escape（外层根也不补查）', () => {
    // 文档属于嵌套根 d:\ws\rootA\nested（最具体根）；rootA 本身也是工作区根，
    // 但 rootDir 只认最具体根——规划器不产生根外候选，跨根补查无从发生
    const nested: VaultLinkResolveContext = {
      docDir: 'd:\\ws\\rootA\\nested\\sub',
      rootDir: 'd:\\ws\\rootA\\nested',
      isWindowsHost: true,
      hasWorkspace: true,
    }
    expect(planVaultLinkPath('../../设计', nested)).toEqual({ kind: 'escape', detail: '../../设计' })
    expect(planVaultLinkPath('../设计', nested)).toEqual({
      kind: 'inside',
      candidates: ['d:\\ws\\rootA\\nested\\设计', 'd:\\ws\\rootA\\nested\\设计.md'],
    })
  })
})

describe('resolveVaultLinkFile：存在性解析（exists 端口注入）', () => {
  it('同目录短名命中补 .md 候选；精确候选优先', async () => {
    const md = existsOf('d:\\notes\\子目录\\设计.md')
    expect(await resolveVaultLinkFile('设计', WIN, md)).toEqual({
      kind: 'target',
      fsPath: 'd:\\notes\\子目录\\设计.md',
    })
    // 精确路径（无扩展名的字面文件）存在时优先于 .md 候选
    const both = existsOf('d:\\notes\\子目录\\设计', 'd:\\notes\\子目录\\设计.md')
    expect(await resolveVaultLinkFile('设计', WIN, both)).toEqual({
      kind: 'target',
      fsPath: 'd:\\notes\\子目录\\设计',
    })
  })

  it('子目录短名未命中且未注入补查端口：维持 not-found（端口不注入时行为与现状一致）', async () => {
    // docDir=子目录 下没有 设计.md：根下虽有同名文件，无补查端口时不得命中
    const md = existsOf('d:\\notes\\other\\设计.md', 'd:\\notes\\设计.md', 'd:\\notes\\子目录\\其他.md')
    expect(await resolveVaultLinkFile('设计', WIN, md)).toEqual({ kind: 'not-found' })
  })

  it('同名多文件直接按文档相对路径判定（ambiguous/用户选择形态废除）', async () => {
    const md = existsOf('d:\\notes\\子目录\\同名.md', 'd:\\notes\\同名.md')
    expect(await resolveVaultLinkFile('同名.md', WIN, md)).toEqual({
      kind: 'target',
      fsPath: 'd:\\notes\\子目录\\同名.md',
    })
  })

  it('明确子路径与根内 ../ 上行照常命中', async () => {
    const md = existsOf('d:\\notes\\子目录\\项目甲\\设计.md', 'd:\\notes\\设计.md')
    expect(await resolveVaultLinkFile('项目甲/设计', WIN, md)).toEqual({
      kind: 'target',
      fsPath: 'd:\\notes\\子目录\\项目甲\\设计.md',
    })
    expect(await resolveVaultLinkFile('../设计', WIN, md)).toEqual({
      kind: 'target',
      fsPath: 'd:\\notes\\设计.md',
    })
  })

  it('越出所属根：escape，且不触碰存在性端口（解析在探测之前拦截）', async () => {
    let probed = 0
    const exists = (): string | null => {
      probed += 1
      return '不应对越界目标探测'
    }
    expect(await resolveVaultLinkFile('../../设计', WIN, exists)).toEqual({
      kind: 'escape',
      detail: '../../设计',
    })
    expect(probed).toBe(0)
  })

  it('无工作区：no-workspace（不猜测目标）', async () => {
    expect(await resolveVaultLinkFile('目标', { ...WIN, hasWorkspace: false }, existsOf())).toEqual({
      kind: 'no-workspace',
    })
  })

  it('空目标：not-found（本文件锚点已在形态学层分流，防御性口径）', async () => {
    expect(await resolveVaultLinkFile('', WIN, existsOf())).toEqual({ kind: 'not-found' })
    expect(await resolveVaultLinkFile('   ', WIN, existsOf())).toEqual({ kind: 'not-found' })
  })

  it('零命中：not-found（不自动建文件）', async () => {
    expect(await resolveVaultLinkFile('不存在', WIN, existsOf('d:\\notes\\子目录\\其他.md'))).toEqual({
      kind: 'not-found',
    })
  })

  it('大小写语义由 exists 端口的宿主文件系统裁决；target 取端口归正的真实路径', async () => {
    // Windows 本地（NTFS 不敏感 + 归正）：探测路径不敏感命中后，端口返回
    // 磁盘真实大小写形态——target 不得停留在注入形态（否则面板 URI 与
    // 真实文档身份漂移，集成实测教训）
    const ntfs = (p: string): string | null =>
      p.toLowerCase() === 'd:\\notes\\子目录\\casenote.md' ? 'd:\\notes\\子目录\\CaseNote.md' : null
    expect(await resolveVaultLinkFile('CaseNote', WIN, ntfs)).toEqual({
      kind: 'target',
      fsPath: 'd:\\notes\\子目录\\CaseNote.md',
    })
    // 远程 POSIX（严格）：大小写不同即不存在（null）
    const posixStrict = (p: string): string | null =>
      p === '/home/u/notes/sub/CaseNote.md' ? p : null
    expect(await resolveVaultLinkFile('casenote', POSIX, posixStrict)).toEqual({ kind: 'not-found' })
    expect(await resolveVaultLinkFile('CaseNote', POSIX, posixStrict)).toEqual({
      kind: 'target',
      fsPath: '/home/u/notes/sub/CaseNote.md',
    })
  })
})

describe('短名补查（#556：端口注入时查所属根内唯一同名 Markdown）', () => {
  /** 补查端口替身：记录查询键（完整 basename 含扩展名），返回预设结果 */
  function lookupOf(candidates: string[], complete = true) {
    const calls: string[] = []
    const port = async (basename: string) => {
      calls.push(basename)
      return { candidates, complete }
    }
    return { port, calls }
  }

  it('唯一候选且清单完整：命中 target（fsPath 取端口给定的磁盘真实形态）', async () => {
    const { port } = lookupOf(['d:\\notes\\资料\\设计.md'], true)
    expect(await resolveVaultLinkFile('设计', WIN, existsOf(), undefined, port)).toEqual({
      kind: 'target',
      fsPath: 'd:\\notes\\资料\\设计.md',
    })
  })

  it('补查候选即端口给定的 Markdown 真实路径：不再经 exists 端口二次探测', async () => {
    // exists 端口一无所知（全部 null）时 target 仍取端口候选——磁盘真实
    // 性由补查端口（索引侧）担保，resolve 不做第二套 IO
    const nothing = (): string | null => null
    const { port } = lookupOf(['d:\\notes\\资料\\设计.md'], true)
    expect(await resolveVaultLinkFile('设计', WIN, nothing, undefined, port)).toEqual({
      kind: 'target',
      fsPath: 'd:\\notes\\资料\\设计.md',
    })
  })

  it('无扩展名短名的查询键补 .md（省略扩展名默认 Markdown 语义）', async () => {
    const { port, calls } = lookupOf(['d:\\notes\\资料\\设计.md'])
    await resolveVaultLinkFile('设计', WIN, existsOf(), undefined, port)
    expect(calls).toEqual(['设计.md'])
  })

  it('显式 .md 短名的查询键原样（含扩展名）', async () => {
    const { port, calls } = lookupOf([])
    await resolveVaultLinkFile('设计.md', WIN, existsOf(), undefined, port)
    expect(calls).toEqual(['设计.md'])
  })

  it('多个候选：ambiguous（无论清单是否完整），不归任一候选', async () => {
    for (const complete of [true, false]) {
      const { port } = lookupOf(['d:\\notes\\资料\\设计.md', 'd:\\notes\\归档\\设计.md'], complete)
      expect(await resolveVaultLinkFile('设计', WIN, existsOf(), undefined, port)).toEqual({
        kind: 'ambiguous',
        candidates: ['d:\\notes\\资料\\设计.md', 'd:\\notes\\归档\\设计.md'],
      })
    }
  })

  it('唯一候选但清单不完整：pending（不声明唯一，更新中状态）', async () => {
    const { port } = lookupOf(['d:\\notes\\资料\\设计.md'], false)
    expect(await resolveVaultLinkFile('设计', WIN, existsOf(), undefined, port)).toEqual({
      kind: 'pending',
    })
  })

  it('零候选：not-found（完整清单没有候选，保留来源原文）', async () => {
    const { port } = lookupOf([], true)
    expect(await resolveVaultLinkFile('设计', WIN, existsOf(), undefined, port)).toEqual({
      kind: 'not-found',
    })
  })

  it('相对优先：同目录候选命中时不触发补查（端口不被调用）', async () => {
    const { port, calls } = lookupOf(['d:\\notes\\资料\\设计.md'])
    const md = existsOf('d:\\notes\\子目录\\设计.md')
    expect(await resolveVaultLinkFile('设计', WIN, md, undefined, port)).toEqual({
      kind: 'target',
      fsPath: 'd:\\notes\\子目录\\设计.md',
    })
    expect(calls).toEqual([])
  })

  it('含分隔符的明确相对路径不补查：./ ../ 与子路径（端口不被调用）', async () => {
    for (const rawPath of ['./设计', '../设计', '资料/设计', '资料\\设计']) {
      const { port, calls } = lookupOf(['d:\\notes\\资料\\设计.md'])
      const resolution = await resolveVaultLinkFile(rawPath, WIN, existsOf(), undefined, port)
      expect(resolution).toEqual({ kind: 'not-found' })
      expect(calls).toEqual([])
    }
  })

  it('补查仅面向 Markdown 语义：显式非 .md 扩展名与 implicitMd=false 不触发', async () => {
    const { port, calls } = lookupOf(['d:\\notes\\资料\\设计.md'])
    expect(await resolveVaultLinkFile('手册.pdf', WIN, existsOf(), undefined, port)).toEqual({
      kind: 'not-found',
    })
    expect(await resolveVaultLinkFile('图', WIN, existsOf(), { implicitMd: false }, port)).toEqual({
      kind: 'not-found',
    })
    expect(calls).toEqual([])
  })

  it('越界目标不补查：escape 维持且端口不被调用（解析在探测之前拦截）', async () => {
    const { port, calls } = lookupOf(['d:\\notes\\资料\\设计.md'])
    expect(await resolveVaultLinkFile('../../设计', WIN, existsOf(), undefined, port)).toEqual({
      kind: 'escape',
      detail: '../../设计',
    })
    expect(calls).toEqual([])
  })

  it('无工作区：相对目标不补查（no-workspace 维持，不猜其他根）', async () => {
    const { port, calls } = lookupOf(['d:\\notes\\资料\\设计.md'])
    const noWs = { ...WIN, hasWorkspace: false }
    expect(await resolveVaultLinkFile('设计', noWs, existsOf(), undefined, port)).toEqual({
      kind: 'no-workspace',
    })
    expect(calls).toEqual([])
  })
})

describe('绝对路径独立解析（#556：不接 docDir、不受根边界、无工作区也成立）', () => {
  it('Windows 盘符：候选按序探测，target 取端口归正的真实形态', async () => {
    // NTFS 不敏感 + 归正语义端口：小写盘符探测命中后返回磁盘真实形态
    const ntfs = (p: string): string | null =>
      p.toLowerCase() === 'c:\\外部库\\资料\\目标.md' ? 'C:\\外部库\\资料\\目标.md' : null
    expect(await resolveVaultLinkFile('c:/外部库/资料/目标.md', WIN, ntfs)).toEqual({
      kind: 'target',
      fsPath: 'C:\\外部库\\资料\\目标.md',
    })
  })

  it('Windows 盘符：无扩展名时候选序精确优先、.md 其次（与 inside 同规则）', async () => {
    const md = existsOf('c:\\外部\\目标.md')
    expect(await resolveVaultLinkFile('c:\\外部\\目标', WIN, md)).toEqual({
      kind: 'target',
      fsPath: 'c:\\外部\\目标.md',
    })
  })

  it('绝对路径未命中：not-found，且注入补查端口也不触发（绝对路径无需短名补查）', async () => {
    const calls: string[] = []
    const port = async (basename: string) => {
      calls.push(basename)
      return { candidates: [] as string[], complete: true }
    }
    expect(await resolveVaultLinkFile('c:\\外部\\目标.md', WIN, existsOf(), undefined, port)).toEqual({
      kind: 'not-found',
    })
    expect(calls).toEqual([])
  })

  it('POSIX 宿主根路径：独立解析（含根外目标）', async () => {
    const md = existsOf('/srv/notes/目标.md')
    expect(await resolveVaultLinkFile('/srv/notes/目标.md', POSIX, md)).toEqual({
      kind: 'target',
      fsPath: '/srv/notes/目标.md',
    })
    expect(await resolveVaultLinkFile('/etc/目标.md', POSIX, existsOf())).toEqual({
      kind: 'not-found',
    })
  })

  it('无工作区：绝对路径仍独立解析（先于 no-workspace 判定），相对目标维持 no-workspace', async () => {
    const noWs = { ...WIN, hasWorkspace: false }
    const md = existsOf('c:\\外部\\目标.md')
    expect(await resolveVaultLinkFile('c:\\外部\\目标.md', noWs, md)).toEqual({
      kind: 'target',
      fsPath: 'c:\\外部\\目标.md',
    })
    expect(await resolveVaultLinkFile('c:\\外部\\目标.md', noWs, existsOf())).toEqual({
      kind: 'not-found',
    })
    expect(await resolveVaultLinkFile('相对目标', noWs, md)).toEqual({ kind: 'no-workspace' })
  })
})

// P1-1（review 修复）新增导出：前端直供绝对路径身份的静态边界复核入口
// （host 侧 directTarget 通道复用同一根内语义，不建第二套边界判定）。
describe('isVaultPathInsideRoot：绝对路径根内判定（P1-1 静态边界复用入口）', () => {
  it('Windows 语义：根内/子目录/大小写漂移放行，上行出根/跨盘符/相对形态拒绝', () => {
    expect(isVaultPathInsideRoot('d:\\notes\\a.md', WIN)).toBe(true)
    expect(isVaultPathInsideRoot('d:\\notes\\子目录\\deep\\x.md', WIN)).toBe(true)
    // win32.relative 大小写不敏感比较——注入形态与根仅大小写不同仍属根内
    expect(isVaultPathInsideRoot('D:\\Notes\\a.md', WIN)).toBe(true)
    expect(isVaultPathInsideRoot('d:\\notes\\..\\outside.md', WIN)).toBe(false)
    expect(isVaultPathInsideRoot('e:\\notes\\a.md', WIN)).toBe(false)
    // 相对路径不做 cwd 依赖解析（path.relative 会按 process.cwd() 补全，
    // cwd 恰在根内时会误放行）
    expect(isVaultPathInsideRoot('a.md', WIN)).toBe(false)
    expect(isVaultPathInsideRoot('.\\a.md', WIN)).toBe(false)
  })

  it('POSIX 语义：根内放行，上行出根/绝对形态差异拒绝；根本身算根内', () => {
    expect(isVaultPathInsideRoot('/home/u/notes/a.md', POSIX)).toBe(true)
    expect(isVaultPathInsideRoot('/home/u/notes', POSIX)).toBe(true)
    // POSIX 大小写敏感：/home/u/Notes 不在 /home/u/notes 内
    expect(isVaultPathInsideRoot('/home/u/Notes/a.md', POSIX)).toBe(false)
    expect(isVaultPathInsideRoot('/home/u/notes/../outside.md', POSIX)).toBe(false)
    expect(isVaultPathInsideRoot('a.md', POSIX)).toBe(false)
  })

  // 修 8（review 第二轮）：directTarget 的 UNC 形态回归报警——语义与
  // Node 24 实测对齐（当前实现正确；跨宿主/越根上行拒绝的边界此前不在
  // 此前不在矩阵内，防未来改动回退）。UNC 的「宿主+共享」段是路径身份
  // 的一部分：win32.relative 对不同宿主返回绝对形态（isAbsolute 拒绝），
  // 同宿主上行以 `..` 前缀拒绝
  it('UNC 语义：同宿主根内放行；跨 UNC 宿主（server-a vs server-b）拒绝', () => {
    const UNC: VaultLinkResolveContext = {
      docDir: '\\\\server\\share\\notes\\sub',
      rootDir: '\\\\server\\share\\notes',
      isWindowsHost: true,
      hasWorkspace: true,
    }
    expect(isVaultPathInsideRoot('\\\\server\\share\\notes\\sub\\a.md', UNC)).toBe(true)
    expect(isVaultPathInsideRoot('\\\\SERVER\\share\\notes\\sub\\a.md', UNC)).toBe(true) // 大小写不敏感
    expect(isVaultPathInsideRoot('\\\\server-b\\share\\notes\\sub\\a.md', UNC)).toBe(false)
    expect(isVaultPathInsideRoot('//server-b/share/notes/sub/a.md', UNC)).toBe(false)
  })

  it('UNC 语义：同宿主越根上行（.. 逃出 share 内根）拒绝', () => {
    const UNC: VaultLinkResolveContext = {
      docDir: '\\\\server\\share\\notes\\sub',
      rootDir: '\\\\server\\share\\notes',
      isWindowsHost: true,
      hasWorkspace: true,
    }
    expect(isVaultPathInsideRoot('\\\\server\\share\\notes\\..\\outside.md', UNC)).toBe(false)
    expect(isVaultPathInsideRoot('\\\\server\\share\\x\\..\\..\\outside.md', UNC)).toBe(false)
    expect(isVaultPathInsideRoot('\\\\server\\share\\notes', UNC)).toBe(true) // 根本身算根内
  })
})
