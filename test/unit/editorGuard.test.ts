// #322 默认编辑器守护——共享纯逻辑矩阵测试（规格第六节单测面）：
// 接管判定 / 写回值构造 / 版本三元组比较 / 拒绝记录语义 / 持久化清洗。
// #323 增设置页状态行四形态判定（classifyDefaultEditorDisplay）矩阵。
// 被测模块 src/shared/editorGuard（检测与写回共用同一键集常量的事实源）。
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_EDITOR_ASSOCIATION_VALUE,
  EDITOR_ASSOCIATION_BASE_KEYS,
  EDITOR_ASSOCIATION_DETECT_ORDER,
  EDITOR_ASSOCIATION_SPECIFIC_KEYS,
  VSIDIAN_EDITOR_VIEW_TYPE,
  buildEditorAssociationsFix,
  classifyDefaultEditorDisplay,
  detectEditorTakeover,
  isPassiveSuppressedBy,
  sanitizeEditorGuardPersisted,
  sameEditorGuardVersion,
} from '../../src/shared/editorGuard'

describe('editorGuard 键集常量（单一事实源）', () => {
  it('基础键与 selector 声明一致（写回常写）', () => {
    expect([...EDITOR_ASSOCIATION_BASE_KEYS]).toEqual(['*.md', '*.markdown'])
  })
  it('特异键为两个 **/* 形态（写回仅已存在时覆盖）', () => {
    expect([...EDITOR_ASSOCIATION_SPECIFIC_KEYS]).toEqual(['**/*.md', '**/*.markdown'])
  })
  it('检测顺序为 glob 字符串长度降序（与宿主 1.82 仲裁同向）', () => {
    expect([...EDITOR_ASSOCIATION_DETECT_ORDER]).toEqual(
      ['**/*.markdown', '*.markdown', '**/*.md', '*.md'])
  })
})

describe('detectEditorTakeover 接管判定矩阵', () => {
  it('配置未定义（无记录）不算接管', () => {
    expect(detectEditorTakeover(undefined)).toEqual({ takenOver: false })
    expect(detectEditorTakeover(null)).toEqual({ takenOver: false })
  })
  it('空对象不算接管', () => {
    expect(detectEditorTakeover({})).toEqual({ takenOver: false })
  })
  it('非对象形态（字符串/数组）按无记录处理', () => {
    expect(detectEditorTakeover('*.md')).toEqual({ takenOver: false })
    expect(detectEditorTakeover(['*.md'])).toEqual({ takenOver: false })
  })
  it('已是我不算接管（四键全我）', () => {
    expect(detectEditorTakeover({
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE,
      '**/*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '**/*.markdown': VSIDIAN_EDITOR_VIEW_TYPE,
    })).toEqual({ takenOver: false })
  })
  it('值为 default（内置文本编辑器）也算接管', () => {
    expect(detectEditorTakeover({ '*.md': BUILTIN_EDITOR_ASSOCIATION_VALUE }))
      .toEqual({ takenOver: true, takerViewType: 'default' })
  })
  it('值为他人即接管并给出抢占者 viewType', () => {
    expect(detectEditorTakeover({ '*.md': 'vscode.office.editor' }))
      .toEqual({ takenOver: true, takerViewType: 'vscode.office.editor' })
  })
  it('多键混合：更特异（更长 glob）的非我键报告为抢占者', () => {
    expect(detectEditorTakeover({
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '**/*.md': 'cweijan.vscode-office.editor',
    })).toEqual({ takenOver: true, takerViewType: 'cweijan.vscode-office.editor' })
    // 长度降序第一个非我键胜出（**/*.markdown > *.markdown > **/*.md > *.md）
    expect(detectEditorTakeover({
      '*.md': 'a.editor',
      '*.markdown': 'b.editor',
      '**/*.md': 'c.editor',
      '**/*.markdown': 'd.editor',
    })).toEqual({ takenOver: true, takerViewType: 'd.editor' })
  })
  it('仅特异键存在（基础键无记录）也算接管', () => {
    expect(detectEditorTakeover({ '**/*.markdown': 'other.editor' }))
      .toEqual({ takenOver: true, takerViewType: 'other.editor' })
    expect(detectEditorTakeover({ '**/*.md': 'other.editor' }))
      .toEqual({ takenOver: true, takerViewType: 'other.editor' })
  })
  it('键存在但值为空字符串：视为非我（接管，抢占者身份为空串）', () => {
    expect(detectEditorTakeover({ '*.md': '' }))
      .toEqual({ takenOver: true, takerViewType: '' })
  })
  it('键存在但值为 null/undefined：视同无记录，不算接管', () => {
    expect(detectEditorTakeover({ '*.md': null })).toEqual({ takenOver: false })
    expect(detectEditorTakeover({ '*.md': undefined })).toEqual({ takenOver: false })
  })
  it('其他文件类型的映射不参与判定', () => {
    expect(detectEditorTakeover({ '*.ipynb': 'jupyter.notebook.ipynb' }))
      .toEqual({ takenOver: false })
  })
})

describe('buildEditorAssociationsFix 写回值构造（基于 inspect().globalValue 基底）', () => {
  it('global 层为空（undefined）时新建两基础键', () => {
    expect(buildEditorAssociationsFix(undefined)).toEqual({
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE,
    })
  })
  it('合并保留无关文件类型映射', () => {
    expect(buildEditorAssociationsFix({
      '*.md': 'default',
      '*.ipynb': 'jupyter.notebook.ipynb',
    })).toEqual({
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.ipynb': 'jupyter.notebook.ipynb',
    })
  })
  it('只动目标键：已是我且无他键时不改其他映射', () => {
    expect(buildEditorAssociationsFix({
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.csv': 'csv.editor',
    })).toEqual({
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.csv': 'csv.editor',
    })
  })
  it('已存在的特异键非我一并覆盖', () => {
    expect(buildEditorAssociationsFix({
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '**/*.md': 'other.editor',
      '**/*.markdown': 'default',
    })).toEqual({
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE,
      '**/*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '**/*.markdown': VSIDIAN_EDITOR_VIEW_TYPE,
    })
  })
  it('不新增不存在的特异键（最小干预）', () => {
    expect(buildEditorAssociationsFix({ '*.md': 'default' })).not.toHaveProperty('**/*.md')
    expect(buildEditorAssociationsFix({ '*.md': 'default' })).not.toHaveProperty('**/*.markdown')
  })
  it('特异键已是我时保持幂等', () => {
    expect(buildEditorAssociationsFix({
      '**/*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.md': 'default',
    })).toEqual({
      '**/*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE,
    })
  })
  it('基底非对象形态（垃圾存量）按空基底新建', () => {
    expect(buildEditorAssociationsFix('garbage')).toEqual({
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE,
    })
  })
  it('基底中非字符串值的键按垃圾丢弃（update 值形态合法性防御）', () => {
    expect(buildEditorAssociationsFix({
      '*.md': 'default',
      '*.csv': 42,
    })).toEqual({
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE,
    })
  })
})

describe('sameEditorGuardVersion 版本锁三元组比较', () => {
  it('相等', () => {
    expect(sameEditorGuardVersion('1.2.3', '1.2.3')).toBe(true)
    expect(sameEditorGuardVersion('0.47.0', '0.47.0')).toBe(true)
  })
  it('升级不相等（下次启动触发主动检测）', () => {
    expect(sameEditorGuardVersion('1.2.3', '1.2.4')).toBe(false)
    expect(sameEditorGuardVersion('1.2.3', '1.3.0')).toBe(false)
    expect(sameEditorGuardVersion('1.2.3', '2.0.0')).toBe(false)
  })
  it('降级不相等（规格：含降级）', () => {
    expect(sameEditorGuardVersion('1.2.4', '1.2.3')).toBe(false)
    expect(sameEditorGuardVersion('2.0.0', '1.9.9')).toBe(false)
  })
  it('多段数字：按前三段数值比较（第四段不参与）', () => {
    expect(sameEditorGuardVersion('1.2.3.4', '1.2.3.4')).toBe(true)
    expect(sameEditorGuardVersion('1.2.3.4', '1.2.3.5')).toBe(true)
    expect(sameEditorGuardVersion('1.2.3.4', '1.2.4.0')).toBe(false)
  })
  it('预发布后缀：段内数字前缀参与比较', () => {
    expect(sameEditorGuardVersion('1.2.3-beta.1', '1.2.3')).toBe(true)
    expect(sameEditorGuardVersion('1.2.3', '1.2.3-beta.1')).toBe(true)
    expect(sameEditorGuardVersion('1.2.3-beta.1', '1.2.4-beta.2')).toBe(false)
  })
  it('退化形态（解析不出三段数字）视为不相等——宁可多提示一次', () => {
    expect(sameEditorGuardVersion('beta', 'beta')).toBe(false)
    expect(sameEditorGuardVersion('1.x.3', '1.2.3')).toBe(false)
    expect(sameEditorGuardVersion('1.2', '1.2')).toBe(false)
    expect(sameEditorGuardVersion('v1.2.3', '1.2.3')).toBe(false)
  })
  it('锁不存在（首装）不相等', () => {
    expect(sameEditorGuardVersion(undefined, '1.2.3')).toBe(false)
    expect(sameEditorGuardVersion(null, '1.2.3')).toBe(false)
    expect(sameEditorGuardVersion('', '1.2.3')).toBe(false)
  })
})

describe('sanitizeEditorGuardPersisted 持久化清洗', () => {
  it('undefined / 垃圾形态回落空态', () => {
    expect(sanitizeEditorGuardPersisted(undefined)).toEqual({ versionLock: null, rejections: [] })
    expect(sanitizeEditorGuardPersisted('garbage')).toEqual({ versionLock: null, rejections: [] })
    expect(sanitizeEditorGuardPersisted([1, 2])).toEqual({ versionLock: null, rejections: [] })
  })
  it('合法形态原样保留', () => {
    expect(sanitizeEditorGuardPersisted({ versionLock: '1.2.3', rejections: ['a.editor'] }))
      .toEqual({ versionLock: '1.2.3', rejections: ['a.editor'] })
  })
  it('非法字段逐项清洗：非字符串/空字符串版本锁置 null；拒绝列表滤非字符串并去重', () => {
    expect(sanitizeEditorGuardPersisted({ versionLock: 5, rejections: 'x' }))
      .toEqual({ versionLock: null, rejections: [] })
    expect(sanitizeEditorGuardPersisted({ versionLock: '', rejections: [1, 'a', 'a', ''] }))
      .toEqual({ versionLock: null, rejections: ['a'] })
  })
})

describe('isPassiveSuppressedBy 拒绝记录语义（被动层压制判定）', () => {
  it('同抢占者在记录中：压制被动层提示', () => {
    expect(isPassiveSuppressedBy(['cweijan.vscode-office.editor'], 'cweijan.vscode-office.editor'))
      .toBe(true)
  })
  it('换抢占者（viewType 变化）：放行——重新具备提示资格', () => {
    expect(isPassiveSuppressedBy(['cweijan.vscode-office.editor'], 'other.editor')).toBe(false)
  })
  it('空记录放行', () => {
    expect(isPassiveSuppressedBy([], 'any.editor')).toBe(false)
  })
})

describe('classifyDefaultEditorDisplay 设置页状态行四形态判定（#323）', () => {
  it('无记录（undefined / 空对象 / 非对象 / 键值 null）→ none', () => {
    expect(classifyDefaultEditorDisplay(undefined)).toEqual({ status: 'none', takerViewType: null })
    expect(classifyDefaultEditorDisplay(null)).toEqual({ status: 'none', takerViewType: null })
    expect(classifyDefaultEditorDisplay({})).toEqual({ status: 'none', takerViewType: null })
    expect(classifyDefaultEditorDisplay('*.md')).toEqual({ status: 'none', takerViewType: null })
    expect(classifyDefaultEditorDisplay({ '*.md': null, '*.markdown': undefined }))
      .toEqual({ status: 'none', takerViewType: null })
  })
  it('键存在且全是我 → vsidian（与「无记录」区分——两形态展示不同）', () => {
    expect(classifyDefaultEditorDisplay({ '*.md': VSIDIAN_EDITOR_VIEW_TYPE }))
      .toEqual({ status: 'vsidian', takerViewType: null })
    expect(classifyDefaultEditorDisplay({
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE,
    })).toEqual({ status: 'vsidian', takerViewType: null })
  })
  it('值为内置编辑器 "default" → builtin（关联值原文随行）', () => {
    expect(classifyDefaultEditorDisplay({ '*.md': BUILTIN_EDITOR_ASSOCIATION_VALUE }))
      .toEqual({ status: 'builtin', takerViewType: BUILTIN_EDITOR_ASSOCIATION_VALUE })
  })
  it('值为其他扩展 → other（关联值原文随行，可读名反查归宿主端口）', () => {
    expect(classifyDefaultEditorDisplay({ '*.markdown': 'cweijan.vscode-office.editor' }))
      .toEqual({ status: 'other', takerViewType: 'cweijan.vscode-office.editor' })
  })
  it('多键混合：检测序（glob 长度降序）第一个非我键胜出——最贴近实际打开体验', () => {
    // *.md 是我，**/*.md 被他者占：特异性仲裁下用户打开 .md 走他者
    expect(classifyDefaultEditorDisplay({
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '**/*.md': 'other.editor',
    })).toEqual({ status: 'other', takerViewType: 'other.editor' })
    // 无关文件类型不参与判定
    expect(classifyDefaultEditorDisplay({
      '*.ipynb': 'jupyter.notebook.ipynb',
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
    })).toEqual({ status: 'vsidian', takerViewType: null })
  })
  it('仅特异键存在且非我 → other（特异键参与判定，与 detectEditorTakeover 同键集）', () => {
    expect(classifyDefaultEditorDisplay({ '**/*.markdown': 'default' }))
      .toEqual({ status: 'builtin', takerViewType: 'default' })
  })
  it('键存在但值为空字符串 → other（极端防御形态，展示层回退原文空串）', () => {
    expect(classifyDefaultEditorDisplay({ '*.md': '' }))
      .toEqual({ status: 'other', takerViewType: '' })
  })
  it('与 detectEditorTakeover 口径对齐：none/vsidian 两形态均不接管，builtin/other 均接管', () => {
    for (const associations of [undefined, {}, { '*.md': VSIDIAN_EDITOR_VIEW_TYPE }]) {
      expect(classifyDefaultEditorDisplay(associations).status === 'none' ||
        classifyDefaultEditorDisplay(associations).status === 'vsidian').toBe(true)
      expect(detectEditorTakeover(associations).takenOver).toBe(false)
    }
    for (const associations of [{ '*.md': 'default' }, { '*.md': 'x.editor' }]) {
      const display = classifyDefaultEditorDisplay(associations)
      expect(display.status === 'builtin' || display.status === 'other').toBe(true)
      expect(detectEditorTakeover(associations).takenOver).toBe(true)
    }
  })
})
