// 图片粘贴纯逻辑契约（#161）：目录解析（三模式/越界拒绝/无工作区回退）、
// 子路径规范化、文件名策略（时间戳/原名清洗/合成名判定/重名序号）、
// 扩展名映射与插入文本 percent-encode 编码（与渲染端 normalizeImgSrc 的
// decode 对偶）。全部纯函数、平台无关（URI path 空间，POSIX 风格）。
import { describe, it, expect } from 'vitest'
import {
  buildImageInsertMarkdown,
  candidateImageFileNames,
  encodeImagePathComponent,
  imageExtensionForMime,
  isSyntheticClipboardImageName,
  normalizeImageSubpath,
  pastedImageStem,
  relativePosixImagePath,
  resolveImagePasteDir,
  decodeFileNameHint,
  sanitizeImageFileName,
} from '../../src/host/imagePastePlan'

describe('normalizeImageSubpath（子路径规范化，#161）', () => {
  it('统一分隔符、去尾斜杠与冗余段', () => {
    expect(normalizeImageSubpath('assets')).toBe('assets')
    expect(normalizeImageSubpath('assets/')).toBe('assets')
    expect(normalizeImageSubpath('assets\\sub\\x')).toBe('assets/sub/x')
    expect(normalizeImageSubpath('a//b')).toBe('a/b')
    expect(normalizeImageSubpath('./a/./b')).toBe('a/b')
    expect(normalizeImageSubpath('  assets  ')).toBe('assets')
  })

  it('空串与纯空白合法（= 无子路径）', () => {
    expect(normalizeImageSubpath('')).toBe('')
    expect(normalizeImageSubpath('   ')).toBe('')
  })

  it('绝对路径与 .. 越界拒绝（null）', () => {
    expect(normalizeImageSubpath('/abs/path')).toBeNull()
    expect(normalizeImageSubpath('/assets')).toBeNull()
    expect(normalizeImageSubpath('/')).toBeNull()
    expect(normalizeImageSubpath('C:/abs')).toBeNull()
    expect(normalizeImageSubpath('C:\\abs')).toBeNull()
    expect(normalizeImageSubpath('\\\\server\\share')).toBeNull()
    expect(normalizeImageSubpath('../escape')).toBeNull()
    expect(normalizeImageSubpath('a/../../escape')).toBeNull()
    expect(normalizeImageSubpath('a/..')).toBeNull()
    // 单段 `..` 字面（非越界段名以 .. 开头但不是 ..）不误伤
    expect(normalizeImageSubpath('a/..hidden')).toBe('a/..hidden')
  })

  it('保留中文与空格段', () => {
    expect(normalizeImageSubpath('附件 图片')).toBe('附件 图片')
    expect(normalizeImageSubpath('附件/图片')).toBe('附件/图片')
  })
})

describe('resolveImagePasteDir（三模式目录解析，#161）', () => {
  const docPath = '/data/notes/proj/note.md'
  const docDir = '/data/notes/proj'

  it('same-dir：文档同目录（子路径不生效）', () => {
    expect(
      resolveImagePasteDir({ mode: 'same-dir', subpath: 'assets', docPath, workspaceRootPath: '/data/notes' }),
    ).toEqual({ ok: true, dirPath: docDir, fellBack: false })
  })

  it('workspace-root：工作区根 + 子路径', () => {
    expect(
      resolveImagePasteDir({ mode: 'workspace-root', subpath: 'assets', docPath, workspaceRootPath: '/data/notes' }),
    ).toEqual({ ok: true, dirPath: '/data/notes/assets', fellBack: false })
    expect(
      resolveImagePasteDir({ mode: 'workspace-root', subpath: '', docPath, workspaceRootPath: '/data/notes' }),
    ).toEqual({ ok: true, dirPath: '/data/notes', fellBack: false })
    expect(
      resolveImagePasteDir({ mode: 'workspace-root', subpath: 'a/b', docPath, workspaceRootPath: '/data/notes' }),
    ).toEqual({ ok: true, dirPath: '/data/notes/a/b', fellBack: false })
  })

  it('workspace-root 无工作区：回退同目录并标记 fellBack', () => {
    expect(
      resolveImagePasteDir({ mode: 'workspace-root', subpath: 'assets', docPath, workspaceRootPath: null }),
    ).toEqual({ ok: true, dirPath: docDir, fellBack: true })
  })

  it('relative-to-file：文档目录 + 子路径', () => {
    expect(
      resolveImagePasteDir({ mode: 'relative-to-file', subpath: 'assets', docPath, workspaceRootPath: '/data/notes' }),
    ).toEqual({ ok: true, dirPath: `${docDir}/assets`, fellBack: false })
    expect(
      resolveImagePasteDir({ mode: 'relative-to-file', subpath: '', docPath, workspaceRootPath: null }),
    ).toEqual({ ok: true, dirPath: docDir, fellBack: false })
  })

  it('子路径非法（绝对路径/..）任何模式拒绝', () => {
    expect(
      resolveImagePasteDir({ mode: 'relative-to-file', subpath: '../out', docPath, workspaceRootPath: null }),
    ).toEqual({ ok: false, reason: 'invalid-subpath' })
    expect(
      resolveImagePasteDir({ mode: 'workspace-root', subpath: '/abs', docPath, workspaceRootPath: '/r' }),
    ).toEqual({ ok: false, reason: 'invalid-subpath' })
  })
})

describe('文件名策略（#161）', () => {
  it('sanitizeImageFileName：清洗 Windows 非法字符与控制字符，保留中文空格，去首尾空格与点', () => {
    expect(sanitizeImageFileName('photo <2026>:"/\\|?.png')).toBe('photo 2026.png')
    expect(sanitizeImageFileName('  图片 一.png  ')).toBe('图片 一.png')
    expect(sanitizeImageFileName('.trailing.')).toBe('trailing')
    expect(sanitizeImageFileName('a\u0001b.png')).toBe('ab.png')
  })

  it('全非法/空清洗结果为空串（调用方回退时间戳）', () => {
    expect(sanitizeImageFileName('')).toBe('')
    expect(sanitizeImageFileName('???')).toBe('')
    expect(sanitizeImageFileName('...')).toBe('')
    expect(sanitizeImageFileName(':/\\')).toBe('')
  })

  it('合成名判定：Chromium 对无源名位图合成的 image.png 类名不沿用', () => {
    expect(isSyntheticClipboardImageName('image.png')).toBe(true)
    expect(isSyntheticClipboardImageName('image.jpg')).toBe(true)
    expect(isSyntheticClipboardImageName('')).toBe(true)
    expect(isSyntheticClipboardImageName('screenshot 2026.png')).toBe(false)
    expect(isSyntheticClipboardImageName('照片.png')).toBe(false)
  })

  it('时间戳 stem：Pasted image YYYYMMDDHHmmss（本地时间）', () => {
    expect(pastedImageStem(new Date(2026, 8, 28, 9, 5, 3))).toBe('Pasted image 20260928090503')
    expect(pastedImageStem(new Date(2026, 11, 31, 23, 59, 59))).toBe('Pasted image 20261231235959')
  })

  it('重名候选：原名 → -1 → -2 递增', () => {
    expect(candidateImageFileNames('Pasted image 20260928090503', '.png', 3)).toEqual([
      'Pasted image 20260928090503.png',
      'Pasted image 20260928090503-1.png',
      'Pasted image 20260928090503-2.png',
    ])
  })
})

describe('扩展名映射（#161）', () => {
  it('常见 mime 映射固定扩展名', () => {
    expect(imageExtensionForMime('image/png')).toBe('.png')
    expect(imageExtensionForMime('image/jpeg')).toBe('.jpg')
    expect(imageExtensionForMime('image/gif')).toBe('.gif')
    expect(imageExtensionForMime('image/webp')).toBe('.webp')
    expect(imageExtensionForMime('image/bmp')).toBe('.bmp')
  })

  it('其余 image/* 按 subtype 兜底；不可用回退 .png', () => {
    expect(imageExtensionForMime('image/tiff')).toBe('.tiff')
    expect(imageExtensionForMime('image/svg+xml')).toBe('.svgxml')
    expect(imageExtensionForMime('image/')).toBe('.png')
    expect(imageExtensionForMime('image/x-icon')).toBe('.x-icon')
  })
})

describe('插入文本编码（#161，与 normalizeImgSrc decode 对偶）', () => {
  it('encodeImagePathComponent：空格/非 ASCII/()<># 编码，安全字符保留', () => {
    expect(encodeImagePathComponent('ab.png')).toBe('ab.png')
    expect(encodeImagePathComponent('a b.png')).toBe('a%20b.png')
    expect(encodeImagePathComponent('图片.png')).toBe('%E5%9B%BE%E7%89%87.png')
    expect(encodeImagePathComponent('a(b)c.png')).toBe('a%28b%29c.png')
    expect(encodeImagePathComponent('a<b>#c.png')).toBe('a%3Cb%3E%23c.png')
    expect(encodeImagePathComponent("a!b'c.png")).toBe('a%21b%27c.png')
    expect(encodeImagePathComponent('~._-')).toBe('~._-')
  })

  it('编码与渲染端 decodeURIComponent 互逆（合法编码必可解码）', () => {
    const cases = ['a b.png', '图片 一.png', 'a(b)c.png', 'x#y.png', 'plain.png']
    for (const c of cases) {
      expect(decodeURIComponent(encodeImagePathComponent(c))).toBe(c)
    }
  })

  it('relativePosixImagePath：同目录直接文件名；子目录前缀；上级目录 ../ 回退', () => {
    expect(relativePosixImagePath('/data/notes/proj', '/data/notes/proj', 'a.png')).toBe('a.png')
    expect(relativePosixImagePath('/data/notes/proj', '/data/notes/assets', 'a.png')).toBe('../assets/a.png')
    expect(relativePosixImagePath('/data/notes/proj', '/data/notes/proj/assets/x', 'a.png')).toBe('assets/x/a.png')
  })

  it('relativePosixImagePath：Windows 盘符大小写不敏感（workspace folder 与文档 URI 来源差异）', () => {
    // 真宿主实测：workspace folder URI 为 /C:/…、文档 URI 为 /c:/…——
    // 盘符字面不同时 posix.relative 会产出逐级向上的逃逸路径，此处钉住归一
    expect(relativePosixImagePath('/c:/Users/u/notes', '/C:/Users/u/notes/assets', 'a.png'))
      .toBe('assets/a.png')
    expect(relativePosixImagePath('/C:/Users/u/notes', '/c:/Users/u/notes', 'a.png')).toBe('a.png')
    expect(relativePosixImagePath('/c:/Users/u/notes', '/C:/Users/u/notes/assets/sub', '图.png'))
      .toBe('assets/sub/图.png')
  })

  it('buildImageInsertMarkdown：stem alt + 编码路径；alt 内 [] 转义', () => {
    expect(buildImageInsertMarkdown('photo', 'assets/photo 1.png')).toBe(
      '![photo](assets/photo%201.png)',
    )
    expect(buildImageInsertMarkdown('图 [片]', 'a.png')).toBe('![图 \\[片\\]](a.png)')
    expect(buildImageInsertMarkdown('Pasted image 20260928090503', 'Pasted image 20260928090503.png')).toBe(
      '![Pasted image 20260928090503](Pasted%20image%2020260928090503.png)',
    )
  })
})


describe('文件名提示解码（#163 验收反馈：percent-encode 形态剪贴板名）', () => {
  it('编码形态先解码再由调用方清洗（中文与空格还原）', () => {
    expect(decodeFileNameHint('%E7%A4%BA%E4%BE%8B%20%E5%9B%BE%E7%89%87%20A.png'))
      .toBe('示例 图片 A.png')
    expect(decodeFileNameHint('%E5%9B%BE.png')).toBe('图.png')
  })
  it('无编码序列原样返回；孤 % 与非法序列不炸（解码失败回退原文）', () => {
    expect(decodeFileNameHint('photo 100%.png')).toBe('photo 100%.png')
    expect(decodeFileNameHint('示例 图片 A.png')).toBe('示例 图片 A.png')
    expect(decodeFileNameHint('bad %zz name.png')).toBe('bad %zz name.png')
  })
})
