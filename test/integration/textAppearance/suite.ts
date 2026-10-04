// #340（P3-08）真宿主高亮对照套件：在真实 VSCode 1.82.3 内驱动生产
// TextAppearanceService（宿主外观服务），断言语法层 token 颜色与 #335
// 探针对照矩阵的已知主题值一致（同管线同色的生产侧证据——「实际文字
// 着色与 P3-03 对照结果一致」）。语义层为观察项（TSLS 激活时序受宿主
// 环境影响，有界等待；不可达不构成失败——原生语义不可用不抹掉语法层）。
// 由 test/integration/runTextAppearance.mjs 以 extensionTestsPath 启动
// （不 --disable-extensions：内置语言/主题扩展必须在场）。
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { TextAppearanceService } from '../../../src/host/textAppearance/appearanceService'
import { decodeTextTokenRuns } from '../../../src/shared/refText'

/** 探针同款 TS 样本（dark-custom 轮；主题原生值断言不受用户自定义影响——
 *  本轮不预置任何自定义，颜色即 Default Dark Modern 主题值） */
const TS_SAMPLE = [
  '// 探针样本：语法 + 语义双层（#335）',
  "import { join } from 'path';",
  '',
  'export interface ProbeSample {',
  '  readonly id: number;',
  '  label: string;',
  '}',
  '',
  "const greeting: string = `hello ${'world'}`;",
  '',
  'export function describe(sample: ProbeSample): string {',
  '  const count = sample.id + 1;',
  '  return `${sample.label}: ${count} (${greeting})`;',
  '}',
  ''].join('\n')

const PLAIN_SAMPLE = '这一行没有语法高亮（plaintext 对照组）。\nno grammar here.\n'

/** Default Dark Modern 主题已知值（探针对照矩阵锚点，见
 *  docs/research/vscode-native-text-appearance-probe.md「主题链与对照矩阵」） */
const DARK_MODERN = {
  keywordControlImport: '#c586c0',
  comment: '#6a9955',
  string: '#ce9178',
  editorForeground: '#cccccc',
}

const failures: string[] = []

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`[textAppearance][PASS] ${label}`)
  } else {
    failures.push(label)
    console.log(`[textAppearance][FAIL] ${label}${detail ? `：${detail}` : ''}`)
  }
}

export async function run(): Promise<void> {
  const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspaceDir) {
    throw new Error('textAppearance 套件需要工作区目录（启动器负责创建）')
  }
  const onigWasm = vscode.Uri.joinPath(vscode.extensions.getExtension('onegayi.vsidian')!.extensionUri, 'out', 'onig.wasm').fsPath
  await fs.access(onigWasm) // wasm 资产随包（esbuild 复制；缺失即装配断言失败）
  const service = new TextAppearanceService(onigWasm)

  // ---- 样本落盘与打开 ----
  const tsPath = path.join(workspaceDir, 'sample.ts')
  const plainPath = path.join(workspaceDir, 'plain.txt')
  await fs.writeFile(tsPath, TS_SAMPLE, 'utf8')
  await fs.writeFile(plainPath, PLAIN_SAMPLE, 'utf8')
  const tsDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(tsPath))
  const plainDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(plainPath))
  check('languageId 身份（宿主按已装语言插件分派）', tsDoc.languageId === 'typescript' && plainDoc.languageId === 'plaintext',
    `ts=${tsDoc.languageId} plain=${plainDoc.languageId}`)

  // ---- 语法层：TS 样本颜色对照（探针锚点值） ----
  const tsTokens = await service.computeTextmateTokens(tsDoc, 1, tsDoc.lineCount)
  check('语法层数据可达（引擎/主题装配成功）', tsTokens !== null)
  if (tsTokens !== null) {
    const runs = decodeTextTokenRuns(tsTokens.data)
    const textOf = (run: { line: number; start: number; length: number }): string =>
      tsDoc.lineAt(run.line).text.substr(run.start, run.length)
    const colorOf = (needle: string): string | undefined => {
      const hit = runs.find((run) => textOf(run) === needle)
      return hit === undefined ? undefined : tsTokens.colors[hit.colorIdx]
    }
    // 颜色比较大小写不敏感（主题文件原样大小写不参与语义）
    const sameColor = (a: string | undefined, b: string): boolean =>
      a !== undefined && a.toLowerCase() === b
    check('import 关键字 = 主题已知值（探针对照锚点）', sameColor(colorOf('import'), DARK_MODERN.keywordControlImport),
      `得 ${colorOf('import') ?? '(未命中)'} 期望 ${DARK_MODERN.keywordControlImport}`)
    const commentRun = runs.find((run) => textOf(run).startsWith('//'))
    const commentColor = commentRun === undefined ? undefined : tsTokens.colors[commentRun.colorIdx]
    check('注释 = 主题已知值', sameColor(commentColor, DARK_MODERN.comment), `得 ${commentColor ?? '(未命中)'} 期望 ${DARK_MODERN.comment}`)
    // 字符串色取 'path' 字面量的内容 run（TS grammar 引号与内容分段）
    const strRun = runs.find((run) => textOf(run) === 'path')
    const strColor = strRun === undefined ? undefined : tsTokens.colors[strRun.colorIdx]
    check('字符串 = 主题已知值', sameColor(strColor, DARK_MODERN.string), `得 ${strColor ?? '(未命中)'} 期望 ${DARK_MODERN.string}`)
  }

  // ---- 语法层：无 grammar 语言纯文本单色（= editor.foreground，对齐不降级） ----
  const plainTokens = await service.computeTextmateTokens(plainDoc, 1, plainDoc.lineCount)
  check('纯文本 token 可达', plainTokens !== null)
  if (plainTokens !== null) {
    const single = plainTokens.colors.every((color) => color.toLowerCase() === DARK_MODERN.editorForeground)
    check('纯文本恰为 editor.foreground 单色（原生无高亮同款）', single, `颜色集 ${JSON.stringify(plainTokens.colors)}`)
  }

  // ---- 窗口裁剪：token 行坐标按窗口内相对行返回 ----
  if (tsTokens !== null) {
    const windowed = await service.computeTextmateTokens(tsDoc, 4, 4)
    const runs = windowed === null ? [] : decodeTextTokenRuns(windowed.data)
    const allInWindow = runs.every((run) => run.line === 0)
    const windowText = runs.map((run) => tsDoc.lineAt(3).text.substr(run.start, run.length)).join('')
    check('硬窗口 token 只含窗口行（相对行坐标）', allInWindow && windowText.includes('export interface'),
      `窗口行内容 "${windowText.slice(0, 40)}"`)
  }

  // ---- 语义层（观察项：TSLS 激活时序受宿主影响，有界等待） ----
  // 打开编辑器触发 onLanguage 激活（探针 S2 同款），legend 有界轮询
  await vscode.window.showTextDocument(tsDoc, { viewColumn: vscode.ViewColumn.One })
  let semanticObserved = 'unavailable'
  for (let attempt = 0; attempt < 20; attempt++) {
    const semantic = await service.computeSemanticTokens(tsDoc, 1, tsDoc.lineCount)
    if (semantic !== null) {
      semanticObserved = `ok(${decodeTextTokenRuns(semantic.data).length} runs, ${semantic.colors.length} colors)`
      break
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  console.log(`[textAppearance][OBSERVE] 语义层可达性：${semanticObserved}（不可达不构成失败——原生语义不可用不抹掉语法层）`)

  // ---- 失效与重建：invalidateAppearance 后缓存重建（颜色不漂移） ----
  service.invalidateAppearance()
  const rebuilt = await service.computeTextmateTokens(tsDoc, 1, tsDoc.lineCount)
  if (tsTokens !== null && rebuilt !== null) {
    const stable = JSON.stringify(rebuilt) === JSON.stringify(tsTokens)
    check('外观缓存失效重建后颜色不漂移', stable)
  } else {
    check('外观缓存失效重建后颜色不漂移', false, '重建不可达')
  }

  if (failures.length > 0) {
    throw new Error(`textAppearance 有 ${failures.length} 项断言失败：\n- ${failures.join('\n- ')}`)
  }
  console.log('[textAppearance] 全部通过')
}
