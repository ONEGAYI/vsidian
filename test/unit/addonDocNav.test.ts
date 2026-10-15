// #543 T03 附加组件文档导航宿主执行体单测（executeAddonDocNav）。
//
// 端口全注入（无 vscode 依赖），覆盖票面 TDD 清单：
// - md 未开/已开重显（openWith 动作恒发生——opened 语义）；
// - md/text 分派：text 走原生编辑器 reveal（行定位）；
// - 来源为嵌入 B 时以 B 目录为解析基准（sourceFsPath 派生 ctx）；
// - 标题/块/行互斥定位：命中、未命中（anchor-not-found）、越界
//   （out-of-bounds 不钳末行）；
// - CRLF：行号 → LF 行首坐标（locateMarkdown 收到的偏移断言）；
// - 无工作区 / 越根 / not-found / 附件类型（pdf/image）非法；
// - 异步等待中目标变短：以执行时权威文本重校验（旧快照行号越界失败）；
// - 来源释放 / 代次结束：迟到执行拒收 view-disposed，不发 locate；
// - 送达失败（无就绪面板）与宿主执行失败（error）分开；
// - 打开与定位结果区分：ok 成功分支 opened/located、失败分支带 opened。
import { describe, expect, it } from 'vitest'
import { executeAddonDocNav, type AddonDocNavExecPorts } from '../../src/host/addonDocNav'

const WS_ROOT = '/ws'
const A_MD = `${WS_ROOT}/notes/a.md`
const B_MD = `${WS_ROOT}/notes/sub/b.md`
const T_TS = `${WS_ROOT}/code/t.ts`
const CRLF_MD = `${WS_ROOT}/notes/crlf.md`
const IMG_PNG = `${WS_ROOT}/img/x.png`

/** 生成 n 行 LF 文本（第 i 行内容 line-i，便于断言偏移） */
function linesText(n: number): string {
  return Array.from({ length: n }, (_, i) => `line-${i + 1}`).join('\n')
}

interface Harness {
  ports: AddonDocNavExecPorts
  openedMarkdown: string[]
  located: Array<{ fsPath: string; lfOffset: number }>
  openedText: Array<{ fsPath: string; lineIdx0: number | null }>
  readTexts: Map<string, string>
  files: Set<string>
  sourceLive: { value: boolean }
  generationLive: { value: boolean }
  hasWorkspace: boolean
}

function makeHarness(overrides: Partial<{
  files: string[]
  texts: Record<string, string>
  sourceLive: boolean
  generationLive: boolean
  hasWorkspace: boolean
  locateDelivered: boolean
  openMarkdownOk: boolean
}> = {}): Harness {
  const h = {} as Harness
  h.openedMarkdown = []
  h.located = []
  h.openedText = []
  h.readTexts = new Map(Object.entries(overrides.texts ?? {}))
  h.files = new Set(overrides.files ?? [A_MD, B_MD, T_TS, CRLF_MD, IMG_PNG])
  h.sourceLive = { value: overrides.sourceLive ?? true }
  h.generationLive = { value: overrides.generationLive ?? true }
  h.hasWorkspace = overrides.hasWorkspace ?? true
  h.ports = {
    statRealPath: async (fsPath) => (h.files.has(fsPath) ? fsPath : null),
    resolveContext: (sourceFsPath) => ({
      docDir: sourceFsPath.slice(0, sourceFsPath.lastIndexOf('/')),
      rootDir: WS_ROOT,
      isWindowsHost: false,
      hasWorkspace: h.hasWorkspace,
    }),
    isSourceLive: () => h.sourceLive.value,
    isGenerationLive: () => h.generationLive.value,
    readDocText: async (fsPath) => h.readTexts.get(fsPath) ?? null,
    openMarkdown: async (fsPath) => {
      h.openedMarkdown.push(fsPath)
      return overrides.openMarkdownOk ?? true
    },
    waitForMarkdownReady: async () => true,
    locateMarkdown: async (fsPath, lfOffset) => {
      h.located.push({ fsPath, lfOffset })
      return overrides.locateDelivered ?? true
    },
    openTextAtLine: async (fsPath, lineIdx0) => {
      h.openedText.push({ fsPath, lineIdx0 })
      return true
    },
  }
  return h
}

describe('executeAddonDocNav：md 打开与定位', () => {
  it('N-U01 未开 md + 标题定位：openWith 后按执行时文本定位', async () => {
    const h = makeHarness({ texts: { [B_MD]: '# Intro\n\ntext\n\n# 第二章\n\nbody\n' } })
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'sub/b.md', locate: { kind: 'heading', heading: '第二章' } },
      h.ports,
    )
    expect(result).toEqual({ ok: true, opened: true, located: true })
    expect(h.openedMarkdown).toEqual([B_MD])
    expect(h.located).toEqual([{ fsPath: B_MD, lfOffset: '# Intro\n\ntext\n\n'.length }])
  })

  it('N-U02 已开 md 重显：openWith 动作照常（opened=true），定位经同一管线', async () => {
    const h = makeHarness({ texts: { [B_MD]: '# H\n' } })
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'sub/b.md', locate: { kind: 'heading', heading: 'H' } },
      h.ports,
    )
    expect(result).toEqual({ ok: true, opened: true, located: true })
    expect(h.openedMarkdown.length).toBe(1)
  })

  it('无 locate 仅打开：located=false', async () => {
    const h = makeHarness()
    const result = await executeAddonDocNav({ sourceFsPath: A_MD, target: 'sub/b.md' }, h.ports)
    expect(result).toEqual({ ok: true, opened: true, located: false })
    expect(h.located).toEqual([])
  })

  it('块 ID 定位（不含 ^ 前缀）', async () => {
    const text = 'para one\npara two ^blk1\n\npara three\n'
    const h = makeHarness({ texts: { [B_MD]: text } })
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'sub/b.md', locate: { kind: 'block', blockId: 'blk1' } },
      h.ports,
    )
    expect(result).toEqual({ ok: true, opened: true, located: true })
    expect(h.located[0]!.lfOffset).toBe(0) // 块首行 = 文件头
  })

  it('行号定位：1-based → LF 行首偏移', async () => {
    const h = makeHarness({ texts: { [B_MD]: linesText(30) } })
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'sub/b.md', locate: { kind: 'line', line: 3 } },
      h.ports,
    )
    expect(result).toEqual({ ok: true, opened: true, located: true })
    expect(h.located[0]!.lfOffset).toBe('line-1\nline-2\n'.length)
  })

  it('N-U06 CRLF 文件行定位：LF 偏移按 \\r\\n 计数收缩（NewlineCoordinator 换算）', async () => {
    const h = makeHarness({ texts: { [CRLF_MD]: 'aaa\r\nbbb\r\nccc\r\nddd\r\n' } })
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'crlf.md', locate: { kind: 'line', line: 4 } },
      h.ports,
    )
    expect(result).toEqual({ ok: true, opened: true, located: true })
    // 宿主偏移 3×5=15（aaa\r\n 每行 5 字符）；LF 偏移 = 3×4 = 12（\r 剥除）
    expect(h.located[0]!.lfOffset).toBe(12)
  })

  it('CRLF 标题定位同样换算为 LF 坐标', async () => {
    const text = '# first\r\n\r\n# 目标\r\n'
    const h = makeHarness({ texts: { [CRLF_MD]: text } })
    await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'crlf.md', locate: { kind: 'heading', heading: '目标' } },
      h.ports,
    )
    // 宿主偏移 11（'# first\r\n\r\n' = 11 字符）；LF 偏移 9（'# first\n\n'）
    expect(h.located[0]!.lfOffset).toBe(9)
  })

  it('同文件锚点（空 target）：目标即来源文档，无需工作区判定', async () => {
    const h = makeHarness({ hasWorkspace: false, texts: { [A_MD]: '# 一\n\n# 二\n' } })
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: '', locate: { kind: 'heading', heading: '二' } },
      h.ports,
    )
    expect(result).toEqual({ ok: true, opened: true, located: true })
    expect(h.openedMarkdown).toEqual([A_MD])
  })
})

describe('executeAddonDocNav：解析与失败矩阵', () => {
  it('N-U07 无工作区跨文档请求：no-workspace，不打开', async () => {
    const h = makeHarness({ hasWorkspace: false })
    const result = await executeAddonDocNav({ sourceFsPath: A_MD, target: 'sub/b.md' }, h.ports)
    expect(result).toEqual({ ok: false, reason: 'no-workspace', opened: false })
    expect(h.openedMarkdown).toEqual([])
  })

  it('越根（../../x）：escape，不打开', async () => {
    const h = makeHarness({ files: ['/x.md'] })
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: '../../x.md' },
      h.ports,
    )
    expect(result).toEqual({ ok: false, reason: 'escape', opened: false })
  })

  it('not-found（候选全未命中，含补 .md 候选）：不打开', async () => {
    const h = makeHarness()
    const result = await executeAddonDocNav({ sourceFsPath: A_MD, target: 'sub/missing' }, h.ports)
    expect(result).toEqual({ ok: false, reason: 'not-found', opened: false })
  })

  it('无扩展名目标补 .md 候选命中（与双链同语义）', async () => {
    const h = makeHarness({ texts: { [B_MD]: '# T\n' } })
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'sub/b', locate: { kind: 'heading', heading: 'T' } },
      h.ports,
    )
    expect(result).toEqual({ ok: true, opened: true, located: true })
  })

  it('N-U04 来源为嵌入 B：相对路径以 B 的目录解析（不误用外层 A）', async () => {
    // B 在 /ws/notes/sub/，C 在 /ws/notes/sub/c.md——从 B 解析 'c.md' 应命中
    const C_MD = `${WS_ROOT}/notes/sub/c.md`
    const h = makeHarness({ files: [B_MD, C_MD], texts: { [C_MD]: '# C\n' } })
    const result = await executeAddonDocNav(
      { sourceFsPath: B_MD, target: 'c.md', locate: { kind: 'heading', heading: 'C' } },
      h.ports,
    )
    expect(result).toEqual({ ok: true, opened: true, located: true })
    expect(h.openedMarkdown).toEqual([C_MD])
  })

  it('附件类型目标（png/pdf）：invalid-request，不执行打开', async () => {
    const h = makeHarness()
    expect(await executeAddonDocNav({ sourceFsPath: A_MD, target: '../img/x.png' }, h.ports))
      .toEqual({ ok: false, reason: 'invalid-request', opened: false })
    expect(h.openedMarkdown).toEqual([])
    expect(h.openedText).toEqual([])
  })

  it('非正整数行号 / 冲突定位载荷：invalid-request（宿主复核层兜住伪造消息）', async () => {
    const h = makeHarness()
    expect(await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'sub/b.md', locate: { kind: 'line', line: 0 } as never },
      h.ports,
    )).toEqual({ ok: false, reason: 'invalid-request', opened: false })
    expect(await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'sub/b.md', locate: { kind: 'heading', heading: '' } as never },
      h.ports,
    )).toEqual({ ok: false, reason: 'invalid-request', opened: false })
    expect(h.openedMarkdown).toEqual([])
  })

  it('标题锚点未命中：anchor-not-found 且 opened=true（报告打开状态）', async () => {
    const h = makeHarness({ texts: { [B_MD]: '# Other\n' } })
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'sub/b.md', locate: { kind: 'heading', heading: '不存在' } },
      h.ports,
    )
    expect(result).toEqual({ ok: false, reason: 'anchor-not-found', opened: true })
    expect(h.located).toEqual([])
  })

  it('块 ID 未命中：anchor-not-found 且 opened=true', async () => {
    const h = makeHarness({ texts: { [B_MD]: 'text\n' } })
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'sub/b.md', locate: { kind: 'block', blockId: 'zzz' } },
      h.ports,
    )
    expect(result).toEqual({ ok: false, reason: 'anchor-not-found', opened: true })
  })

  it('行号越界：out-of-bounds 不钳到末行、不发 locate、opened=true', async () => {
    const h = makeHarness({ texts: { [B_MD]: linesText(10) } })
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'sub/b.md', locate: { kind: 'line', line: 11 } },
      h.ports,
    )
    expect(result).toEqual({ ok: false, reason: 'out-of-bounds', opened: true })
    expect(h.located).toEqual([])
    // 末行行首偏移是 10 行文本的前 9 行长度——若发生钳制 locate 会收到它
    expect(h.located.length).toBe(0)
  })

  it('异步等待中目标变短（外部编辑）：以执行时权威文本重校验，旧行号越界失败', async () => {
    // 打开前文本 100 行（作者视角），执行时读取（readDocText）只剩 10 行
    const h = makeHarness({ texts: { [B_MD]: linesText(10) } })
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'sub/b.md', locate: { kind: 'line', line: 80 } },
      h.ports,
    )
    expect(result).toEqual({ ok: false, reason: 'out-of-bounds', opened: true })
    expect(h.located).toEqual([])
  })

  it('送达失败（无就绪面板）：delivery-failed 与目标不存在分开', async () => {
    const h = makeHarness({ texts: { [B_MD]: '# T\n' }, locateDelivered: false })
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'sub/b.md', locate: { kind: 'heading', heading: 'T' } },
      h.ports,
    )
    expect(result).toEqual({ ok: false, reason: 'delivery-failed', opened: true })
  })

  it('打开失败（openWith 抛错/error）：error 且 opened=false', async () => {
    const h = makeHarness({ openMarkdownOk: false })
    const result = await executeAddonDocNav({ sourceFsPath: A_MD, target: 'sub/b.md' }, h.ports)
    expect(result).toEqual({ ok: false, reason: 'error', opened: false })
  })

  it('权威文本读取失败：error 且 opened=true（已打开）', async () => {
    const h = makeHarness({ texts: {} })
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'sub/b.md', locate: { kind: 'line', line: 1 } },
      h.ports,
    )
    expect(result).toEqual({ ok: false, reason: 'error', opened: true })
  })

  it('来源失效（入口即失效）：view-disposed 不打开', async () => {
    const h = makeHarness({ sourceLive: false })
    const result = await executeAddonDocNav({ sourceFsPath: A_MD, target: 'sub/b.md' }, h.ports)
    expect(result).toEqual({ ok: false, reason: 'view-disposed', opened: false })
  })

  it('N-U12 代次结束（打开后失效）：view-disposed、opened=true、不发 locate（旧偏移不抢回定位）', async () => {
    const h = makeHarness({ texts: { [B_MD]: '# T\n' } })
    // openMarkdown 落地后翻转变失效标志（异步等待窗口内释放）
    h.ports.openMarkdown = async (fsPath) => {
      h.openedMarkdown.push(fsPath)
      h.generationLive.value = false
      return true
    }
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'sub/b.md', locate: { kind: 'heading', heading: 'T' } },
      h.ports,
    )
    expect(result).toEqual({ ok: false, reason: 'view-disposed', opened: true })
    expect(h.located).toEqual([])
  })

  it('N-U12 来源面板关闭（打开后失效）：同 view-disposed 拒收', async () => {
    const h = makeHarness({ texts: { [B_MD]: '# T\n' } })
    h.ports.openMarkdown = async (fsPath) => {
      h.openedMarkdown.push(fsPath)
      h.sourceLive.value = false
      return true
    }
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: 'sub/b.md', locate: { kind: 'line', line: 1 } },
      h.ports,
    )
    expect(result).toEqual({ ok: false, reason: 'view-disposed', opened: true })
    expect(h.located).toEqual([])
  })
})

describe('executeAddonDocNav：text 目标（原生编辑器）', () => {
  it('N-U03 text 行定位：打开后 reveal 到 0-based 目标行并置选区', async () => {
    const h = makeHarness({ texts: { [T_TS]: linesText(50) } })
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: '../code/t.ts', locate: { kind: 'line', line: 42 } },
      h.ports,
    )
    expect(result).toEqual({ ok: true, opened: true, located: true })
    expect(h.openedText.length).toBe(2)
    expect(h.openedText[0]).toEqual({ fsPath: T_TS, lineIdx0: null }) // 先打开（不定位）
    expect(h.openedText[1]).toEqual({ fsPath: T_TS, lineIdx0: 41 }) // 再 reveal 目标行
    expect(h.openedMarkdown).toEqual([])
  })

  it('text 无定位：仅打开', async () => {
    const h = makeHarness()
    const result = await executeAddonDocNav({ sourceFsPath: A_MD, target: '../code/t.ts' }, h.ports)
    expect(result).toEqual({ ok: true, opened: true, located: false })
    expect(h.openedText.length).toBe(1)
  })

  it('text 行越界：out-of-bounds（不钳末行）、opened=true', async () => {
    const h = makeHarness({ texts: { [T_TS]: linesText(5) } })
    const result = await executeAddonDocNav(
      { sourceFsPath: A_MD, target: '../code/t.ts', locate: { kind: 'line', line: 6 } },
      h.ports,
    )
    expect(result).toEqual({ ok: false, reason: 'out-of-bounds', opened: true })
    expect(h.openedText.length).toBe(1) // 只开了，没有第二次 reveal
  })

  it('text 目标携带 heading/block 定位：invalid-request（锚点语义仅 Markdown）', async () => {
    const h = makeHarness()
    expect(await executeAddonDocNav(
      { sourceFsPath: A_MD, target: '../code/t.ts', locate: { kind: 'heading', heading: 'x' } },
      h.ports,
    )).toEqual({ ok: false, reason: 'invalid-request', opened: false })
    expect(h.openedText).toEqual([])
  })
})

describe('executeAddonDocNav：异步边界', () => {
  it('宿主端口异常返回 error，并保留实际已打开状态', async () => {
    const h = makeHarness()
    h.ports.statRealPath = async () => { throw new Error('IO failed') }
    expect(await executeAddonDocNav({ sourceFsPath: A_MD, target: 'sub/b.md' }, h.ports))
      .toEqual({ ok: false, reason: 'error', opened: false })
    h.ports.statRealPath = async (fsPath) => fsPath
    h.ports.waitForMarkdownReady = async () => { throw new Error('panel failed') }
    expect(await executeAddonDocNav({ sourceFsPath: A_MD, target: 'sub/b.md', locate: { kind: 'line', line: 1 } }, h.ports))
      .toEqual({ ok: false, reason: 'error', opened: true })
  })

  it('结构化路径不放开绝对路径或外部协议', async () => {
    const h = makeHarness()
    expect(await executeAddonDocNav({ sourceFsPath: A_MD, target: B_MD }, h.ports))
      .toEqual({ ok: false, reason: 'invalid-request', opened: false })
    h.ports.statRealPath = async (fsPath) => fsPath
    expect(await executeAddonDocNav({ sourceFsPath: A_MD, target: 'https://example.com/a.md' }, h.ports))
      .toEqual({ ok: false, reason: 'invalid-request', opened: false })
    expect(h.openedMarkdown).toEqual([])
  })

  it('真实路径逃出所属根时拒绝，不能经符号链接打开根外文件', async () => {
    const h = makeHarness()
    h.ports.statRealPath = async () => '/outside/private.md'
    expect(await executeAddonDocNav({ sourceFsPath: A_MD, target: 'sub/b.md' }, h.ports))
      .toEqual({ ok: false, reason: 'escape', opened: false })
    expect(h.openedMarkdown).toEqual([])
  })

  it('等待页面就绪后重新读取权威文本，不能向变短目标投递旧偏移', async () => {
    const h = makeHarness({ texts: { [B_MD]: linesText(100) } })
    Object.assign(h.ports, {
      waitForMarkdownReady: async () => {
        h.readTexts.set(B_MD, linesText(2))
        return true
      },
    })
    expect(await executeAddonDocNav({ sourceFsPath: A_MD, target: 'sub/b.md', locate: { kind: 'line', line: 80 } }, h.ports))
      .toEqual({ ok: false, reason: 'out-of-bounds', opened: true })
    expect(h.located).toEqual([])
  })

  it('目标解析期间来源释放，不再执行打开', async () => {
    const h = makeHarness()
    h.ports.statRealPath = async (fsPath) => {
      h.sourceLive.value = false
      return fsPath
    }
    expect(await executeAddonDocNav({ sourceFsPath: A_MD, target: 'sub/b.md' }, h.ports))
      .toEqual({ ok: false, reason: 'view-disposed', opened: false })
    expect(h.openedMarkdown).toEqual([])
  })
})
