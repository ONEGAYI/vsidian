// 全文件清单分类单测（#377 T02）：常用资源分类集中声明（shared/
// vaultFileCategory）——空查询资格按路径后缀派生，零 IO；.pyc 等未知类型
// 显式落入 other（仅记名、mtime 未知沉底），不进空查询但可被有查询命中。
import { describe, expect, it } from 'vitest'
import { READY_CODE_LANGUAGE_FIXTURES } from '../fixtures/readyCodeLanguages'
import { SPECIAL_CODE_LANGUAGE_FIXTURES } from '../fixtures/specialCodeLanguages'
import {
  classifyVaultFileCategory,
  isCommonVaultFileCategory,
} from '../../src/shared/vaultFileCategory'

describe('classifyVaultFileCategory', () => {
  it('Markdown（大小写不敏感）', () => {
    expect(classifyVaultFileCategory('笔记.md')).toBe('markdown')
    expect(classifyVaultFileCategory('sub/笔记.MD')).toBe('markdown')
  })

  it('图片：与图片管线扩展清单同源（IMAGE_WATCH_GLOB_SEGMENTS）', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'apng']) {
      expect(classifyVaultFileCategory(`a.${ext}`)).toBe('image')
      expect(classifyVaultFileCategory(`a.${ext.toUpperCase()}`)).toBe('image')
    }
  })

  it('PDF', () => {
    expect(classifyVaultFileCategory('论文.pdf')).toBe('pdf')
    expect(classifyVaultFileCategory('论文.PDF')).toBe('pdf')
  })

  it('音视频分列（audio 与 video 是不同类别）', () => {
    expect(classifyVaultFileCategory('song.mp3')).toBe('audio')
    expect(classifyVaultFileCategory('voice.flac')).toBe('audio')
    expect(classifyVaultFileCategory('clip.mp4')).toBe('video')
    expect(classifyVaultFileCategory('clip.webm')).toBe('video')
  })

  it('可读文本：集中后缀清单命中（txt/csv/log/代码与配置后缀）', () => {
    for (const ext of ['txt', 'csv', 'log', 'json', 'jsonc', 'json5', 'sql', 'pgsql', 'ts', 'py', 'yaml', 'yml', 'toml', 'ini', 'xml', 'sh']) {
      expect(classifyVaultFileCategory(`x.${ext}`)).toBe('text')
    }
  })

  it('无扩展名按 other（不进空查询——不为判定打开/读取文件）', () => {
    expect(classifyVaultFileCategory('Makefile')).toBe('other')
    expect(classifyVaultFileCategory('LICENSE')).toBe('other')
  })

  it('未知/编译类型按 other：.pyc 不进空查询但身份保留', () => {
    expect(classifyVaultFileCategory('cache.pyc')).toBe('other')
    expect(classifyVaultFileCategory('lib.so')).toBe('other')
    expect(classifyVaultFileCategory('app.exe')).toBe('other')
  })

  it('点号起头文件名（.gitignore 类）不是扩展名分隔——按 other', () => {
    // `.gitignore` 的 lastIndexOf('.') 为 0，无有效扩展名段
    expect(classifyVaultFileCategory('.gitignore')).toBe('other')
  })

  it('目录形态路径不影响判定（取 basename 的扩展名）', () => {
    expect(classifyVaultFileCategory('docs/assets/img/photo.png')).toBe('image')
    expect(classifyVaultFileCategory('docs/深.层/说明.md')).toBe('markdown')
  })
})

describe('isCommonVaultFileCategory（空查询资格）', () => {
  it('md/图片/PDF/音视频/可读文本均为常用资源', () => {
    for (const cat of ['markdown', 'image', 'pdf', 'audio', 'video', 'text'] as const) {
      expect(isCommonVaultFileCategory(cat)).toBe(true)
    }
  })

  it('other 不是常用资源（空查询不列；仅记名可被有查询命中）', () => {
    expect(isCommonVaultFileCategory('other')).toBe(false)
  })
})

describe('ready-language file extensions (#389)', () => {
  it.each([...READY_CODE_LANGUAGE_FIXTURES, ...SPECIAL_CODE_LANGUAGE_FIXTURES])('$id classifies explicit text extensions', ({ extensions }) => {
    for (const ext of extensions) expect(classifyVaultFileCategory(`sample.${ext.toUpperCase()}`)).toBe('text')
  })
  it('fence aliases cannot classify database or extensionless files as text', () => {
    for (const path of ['data.sqlite', 'data.db', 'data.sqlite3', 'sample.postgresql', 'sample.postgres', 'sample.mysql', 'sample.docker', 'sample.csharp', 'sample.kotlin', 'sample.protobuf', 'sample.ngspice', 'sample.hspice', 'sample.make', 'sample.makefile', 'data.raw', 'Dockerfile', 'Makefile', 'LICENSE']) {
      expect(classifyVaultFileCategory(path)).toBe('other')
    }
  })
})
