// T08/#628 Remote SSH e2e 的测试钩子标记文件（远端 ext host 读不到宿主 env
// ——V02 §3.4 实测 server 进程不继承 VSIDIAN_*；沿 T17 的 .vsidian-t17-ssh.json
// 先例，钩子开关与注入路径经工作区根标记文件传递）。
//
// 形态：工作区根 `.vsidian-pdf-remote-test.json`：
//   { "hooks": true, "saveDir": "<本机目录>", "targetDir": "<本机目录>",
//     "saveTarget": "<本机精确路径（单发场景）>" }
// hooks=true 时远端模态的 _test 观测命令可用、对话框端口短路为注入路径
//（写盘仍走执行端真实链路——本机真实落盘可断言）。saveDir 按默认文件名
// 拼接（多次导出互不覆盖）；saveTarget 精确指定时优先。生产窗口无标记
// 文件，一切按发行态语义。

import { readFileSync } from 'node:fs'
import path from 'node:path'

/** 标记文件名（工作区根内、点前缀——扫描器忽略点文件） */
export const PDF_REMOTE_TEST_MARKER_NAME = '.vsidian-pdf-remote-test.json'

export interface PdfRemoteTestHooks {
  hooks: true
  saveTarget?: string
  saveDir?: string
  targetDir?: string
}

/** 读取标记文件（缺席/损坏返回 undefined——回到发行态语义，不静默扩大钩子面） */
export function readPdfRemoteTestHooks(
  readFile: (p: string) => string = (p) => readFileSync(p, 'utf8'),
  workspaceRoot: string | undefined,
): PdfRemoteTestHooks | undefined {
  if (workspaceRoot === undefined || workspaceRoot === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(readFile(path.join(workspaceRoot, PDF_REMOTE_TEST_MARKER_NAME)))
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const v = parsed as { hooks?: unknown; saveTarget?: unknown; saveDir?: unknown; targetDir?: unknown }
  if (v.hooks !== true) return undefined
  return {
    hooks: true,
    ...(typeof v.saveTarget === 'string' && v.saveTarget !== '' ? { saveTarget: v.saveTarget } : {}),
    ...(typeof v.saveDir === 'string' && v.saveDir !== '' ? { saveDir: v.saveDir } : {}),
    ...(typeof v.targetDir === 'string' && v.targetDir !== '' ? { targetDir: v.targetDir } : {}),
  }
}
