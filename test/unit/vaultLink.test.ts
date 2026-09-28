// 根内相对路径解析契约（工单 #196，父规格 #194「路径与范围」）：
// src/shared/vaultLink.ts 是双链与普通链接/图片共用的目标解析单一事实源，
// 本文件钉死：
// - 目标一律按来源文档目录（docDir）相对解析：[[设计]] = docDir/设计(.md)，
//   basename 搜索/根相对兜底/跨根补查不存在（规划器根本不产生根外候选）
// - [[项目甲/设计]] 明确子路径；[[../设计]] 根内上行照常；越出所属根 escape
// - 嵌套根按最具体根划界（rootDir 由调用方注入最具体根——vscode 层
//   getWorkspaceFolder 返回最内层 folder）
// - 扩展名语义：显式扩展名单候选（不产生 x.pdf.md）；无扩展名 implicitMd
//   时 [精确, 精确+.md]（精确优先）；图片语义单候选
// - 分隔符：Windows 宿主反斜杠当分隔符归一；POSIX 宿主上反斜杠是普通
//   文件名字符（远程语义不转换）
// - 大小写语义由 exists 端口的宿主文件系统裁决（NTFS 不敏感 / POSIX
//  严格——本模块不折叠）；Windows 不敏感命中后端口返回磁盘真实大小写
//  路径，target 取归正形态（防面板/文档身份漂移）
// - resolve 层：no-workspace、空目标 not-found、escape 不触探测端口、
//   候选按序取首个存在者
// 迁移自 test/unit/wikilinkTarget.test.ts 的 #196 红灯契约（实现落地后
// wikilinkTarget 回归锚点定位单一职责）。
import { describe, it, expect } from 'vitest'
import {
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

  it('绝对路径形态（盘符/UNC/POSIX 绝对）不在根内：escape', () => {
    expect(planVaultLinkPath('c:/别的/目标.md', WIN)).toEqual({ kind: 'escape', detail: 'c:/别的/目标.md' })
    expect(planVaultLinkPath('\\\\server\\share\\目标.md', WIN)).toEqual({
      kind: 'escape',
      detail: '\\\\server\\share\\目标.md',
    })
    expect(planVaultLinkPath('/etc/目标.md', POSIX)).toEqual({ kind: 'escape', detail: '/etc/目标.md' })
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

  it('子目录或其他位置的同名文件不得命中（basename 搜索废除）', async () => {
    // docDir=子目录 下没有 设计.md：根下虽有同名文件，也不得命中
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
