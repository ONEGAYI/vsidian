// 宿主侧样式契约 JSON 导出纯函数契约（#145）：文件名形态与默认目录
// 回退链（上次目录 > Downloads > 家目录）。vscode 壳（对话框/写盘/通知）
// 由集成路径覆盖（diagramExportHost 同模式）。
import { describe, expect, it } from 'vitest'
import {
  STYLE_REFERENCE_JSON_RELATIVE,
  resolveStyleReferenceExportDefaultDir,
  styleReferenceExportFileName,
} from '../../src/host/styleReferenceExportPlan'

describe('styleReferenceExport 纯函数（#145）', () => {
  it('导出文件名携带扩展版本', () => {
    expect(styleReferenceExportFileName('0.4.0')).toBe('vsidian-style-reference-0.4.0.json')
    expect(styleReferenceExportFileName('1.23.4')).toBe('vsidian-style-reference-1.23.4.json')
  })

  it('契约 JSON 相对路径指向随 VSIX 分发的生成资产', () => {
    const parts = STYLE_REFERENCE_JSON_RELATIVE.replace(/\\/g, '/').split('/')
    expect(parts).toEqual(['media', 'style-reference', 'style-reference.json'])
  })

  it('默认目录回退链：上次目录 > Downloads（存在时）> 家目录', () => {
    expect(resolveStyleReferenceExportDefaultDir('/tmp/last', '/home/suian', '/home/suian/Downloads', true)).toBe('/tmp/last')
    expect(resolveStyleReferenceExportDefaultDir(undefined, '/home/suian', '/home/suian/Downloads', true)).toBe('/home/suian/Downloads')
    expect(resolveStyleReferenceExportDefaultDir(undefined, '/home/suian', '/home/suian/Downloads', false)).toBe('/home/suian')
    expect(resolveStyleReferenceExportDefaultDir('', '/home/suian', '/home/suian/Downloads', true)).toBe('/home/suian/Downloads')
  })
})
