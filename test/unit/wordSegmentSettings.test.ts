// @vitest-environment jsdom
// 中文分词并入编辑器页二级组（#264）：分词分页退役后的组形态契约——
// 侧栏五项无分词入口、编辑器页尾组「中文分词」（委托装配，内容与改版前
// 分词分页一致）、全局搜索分词条目归编辑器分组并定位组内块、宿主按旧
// section id 的 focusSection 兼容路由、引擎/下载源切换与资源状态回显。
// 装配口径与生产 settingsMain.ts 同源（sections 三分页 + editorGroups 一组）。
import { describe, it, expect } from 'vitest'
import { SettingsPageView } from '../../src/webview/settingsPageView'
import { PRODUCTION_SETTING_DEFINITIONS, type SettingsPayload } from '../../src/shared/settings'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { isHostToWebview, type HostToWebview } from '../../src/shared/protocol'
import { KeybindingSettingsSection } from '../../src/webview/keybindingSettings'
import { CssSnippetSettingsSection } from '../../src/webview/cssSnippetSettings'
import { StyleReferenceSection } from '../../src/webview/styleReferenceSettings'
import { AppearanceSection } from '../../src/webview/appearanceSettings'
import { IndexMaintenanceSection } from '../../src/webview/indexMaintenanceSettings'
import {
  WordSegmentSection,
  WORD_SEGMENT_SECTION_ENGINE_ENTRY,
  WORD_SEGMENT_SECTION_RESOURCE_ENTRY,
} from '../../src/webview/wordSegmentSettings'

installLocale('zh-cn', zhCn)

/** 生产装配口径（settingsMain.ts 同构）：分词不再进侧栏 sections，改挂编辑器组委托；
 *  dispatch 模拟 settingsMain 的 message listener——view 与分词组各自消费同一条宿主消息 */
function makeProductionView(): {
  view: SettingsPageView
  wordSegment: WordSegmentSection
  dispatch(message: unknown): void
  sent: unknown[]
  parent: HTMLElement
} {
  const sent: unknown[] = []
  const bridge = { postMessage: (m: unknown) => sent.push(m) }
  const appearance = new AppearanceSection(
    new CssSnippetSettingsSection(bridge), new StyleReferenceSection(bridge))
  const wordSegment = new WordSegmentSection(bridge)
  const view = new SettingsPageView(bridge, PRODUCTION_SETTING_DEFINITIONS,
    [new KeybindingSettingsSection(bridge), appearance, new IndexMaintenanceSection(bridge)],
    [wordSegment])
  const parent = document.createElement('div')
  view.mount(parent)
  return {
    view, wordSegment, sent, parent,
    dispatch: (message: unknown) => {
      view.handleHostMessage(message)
      wordSegment.handleHostMessage(message)
    },
  }
}

const navTitles = (parent: HTMLElement): string[] =>
  [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
    .map((b) => b.textContent ?? '')

const groupTitles = (parent: HTMLElement): string[] =>
  [...parent.querySelectorAll('.vsidian-settings-group-title')].map((el) => el.textContent ?? '')

/** 点击侧栏导航项（按显示文本定位，生产注册表口径） */
function clickNav(parent: HTMLElement, title: string): void {
  const nav = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
    .find((b) => b.textContent === title)!
  nav.click()
}

/** 当前页正文里的分词组容器（编辑器页尾组） */
function wordSegmentGroup(parent: HTMLElement): HTMLElement {
  const group = [...parent.querySelectorAll('.vsidian-settings-group')]
    .find((g) => g.querySelector('.vsidian-settings-group-title')?.textContent ===
      zhCn['wordSegment.title'])
  expect(group, '编辑器页应渲染「中文分词」二级组').toBeTruthy()
  return group as HTMLElement
}

const radiosOf = (parent: HTMLElement, key: string): HTMLInputElement[] =>
  [...parent.querySelectorAll<HTMLInputElement>(`input[name="wordseg-${key}"]`)]

/** 模拟宿主下发 wordSegment.state（经协议校验的正式形态） */
function pushState(
  section: WordSegmentSection,
  state: Partial<Extract<HostToWebview, { kind: 'wordSegment.state' }>> = {},
): void {
  const message: Extract<HostToWebview, { kind: 'wordSegment.state' }> = {
    kind: 'wordSegment.state',
    installed: false,
    version: '',
    status: 'idle',
    notice: null,
    resources: null,
    ...state,
  }
  expect(isHostToWebview(message)).toBe(true)
  section.handleHostMessage(message)
}

const hostValues = (values: Partial<SettingsPayload>): HostToWebview =>
  ({ kind: 'settings.snapshot', values }) as HostToWebview

describe('侧栏与编辑器页组结构（#264）', () => {
  it('侧栏五项：常规/编辑器/快捷键/外观/索引维护，「中文分词」入口退役', () => {
    const { parent } = makeProductionView()
    expect(navTitles(parent)).toEqual([
      zhCn['settings.generalSection'],
      zhCn['settings.editorCategory'],
      zhCn['keybindingSettings.title'],
      zhCn['appearance.title'],
      zhCn['indexMaintenance.title'],
    ])
  })

  it('编辑器页含六个二级组，尾组为「中文分词」（图片组之后）', () => {
    const { parent } = makeProductionView()
    clickNav(parent, zhCn['settings.editorCategory'])
    expect(groupTitles(parent)).toEqual([
      zhCn['settings.groupDisplay'],
      zhCn['settings.groupEditing'],
      zhCn['settings.groupSymbols'],
      zhCn['settings.groupCodeblock'],
      zhCn['settings.groupImage'],
      zhCn['wordSegment.title'],
    ])
  })

  it('分词组内容与改版前分词分页一致：引擎/下载源 radio、自定义 URL、下载/删除管理', () => {
    const { parent } = makeProductionView()
    clickNav(parent, zhCn['settings.editorCategory'])
    const group = wordSegmentGroup(parent)
    expect(radiosOf(group, 'editor.wordSegmentEngine')).toHaveLength(2)
    expect(radiosOf(group, 'editor.wordSegmentSource')).toHaveLength(3)
    expect(group.querySelector<HTMLInputElement>('.vsidian-wordseg-custom-url')).toBeTruthy()
    const buttons = [...group.querySelectorAll<HTMLButtonElement>('button')]
      .map((b) => b.textContent)
    expect(buttons).toContain(zhCn['wordSegment.download'])
    expect(buttons).toContain(zhCn['wordSegment.deleteResource'])
    // 三键不以标准设置行重复呈现（呈现归分词组，排除保留）
    expect(group.querySelectorAll('[data-setting-key]')).toHaveLength(0)
  })

  it('分词组无图标槽位字形（留空待 #265 生图接入），组标题无 svg', () => {
    const { parent } = makeProductionView()
    clickNav(parent, zhCn['settings.editorCategory'])
    expect(wordSegmentGroup(parent).querySelector('.vsidian-settings-group-title svg')).toBeNull()
  })
})

describe('快照回显与操作上送（路径保持现状）', () => {
  it('settings.snapshot 回显引擎与下载源选中态；builtin 时下载源三行禁用', () => {
    const { dispatch, parent } = makeProductionView()
    clickNav(parent, zhCn['settings.editorCategory'])
    dispatch(hostValues({
      'editor.wordSegmentEngine': 'builtin',
      'editor.wordSegmentSource': 'jsdelivr',
    }))
    let group = wordSegmentGroup(parent)
    expect(radiosOf(group, 'editor.wordSegmentEngine').find((r) => r.value === 'builtin')!.checked).toBe(true)
    expect(radiosOf(group, 'editor.wordSegmentSource').every((r) => r.disabled)).toBe(true)
    dispatch(hostValues({
      'editor.wordSegmentEngine': 'jieba',
      'editor.wordSegmentSource': 'npmmirror',
    }))
    group = wordSegmentGroup(parent)
    expect(radiosOf(group, 'editor.wordSegmentEngine').find((r) => r.value === 'jieba')!.checked).toBe(true)
    const npmmirror = radiosOf(group, 'editor.wordSegmentSource').find((r) => r.value === 'npmmirror')!
    expect(npmmirror.checked).toBe(true)
    expect(radiosOf(group, 'editor.wordSegmentSource').every((r) => !r.disabled)).toBe(true)
  })

  it('切换引擎上送 settings.set（键名零迁移）；切换下载源同链路', () => {
    const { sent, parent } = makeProductionView()
    clickNav(parent, zhCn['settings.editorCategory'])
    // jsdom 的 radio click 翻转 checked 但不派发 change：按仓库先例
    // （settingsPage.test.ts 变更上送）显式置态后派发 change
    const radios = (key: string) => radiosOf(wordSegmentGroup(parent), key)
    const fire = (radio: HTMLInputElement) => {
      radio.checked = true
      radio.dispatchEvent(new Event('change'))
    }
    fire(radios('editor.wordSegmentEngine').find((r) => r.value === 'jieba')!)
    expect(sent).toContainEqual({
      kind: 'settings.set',
      values: { 'editor.wordSegmentEngine': 'jieba' },
    })
    fire(radios('editor.wordSegmentSource').find((r) => r.value === 'custom')!)
    expect(sent).toContainEqual({
      kind: 'settings.set',
      values: { 'editor.wordSegmentSource': 'custom' },
    })
  })

  it('wordSegment.state 回显：已安装状态文本与按钮态、下载中禁用、notice 基调', () => {
    const { wordSegment, parent } = makeProductionView()
    clickNav(parent, zhCn['settings.editorCategory'])
    pushState(wordSegment, { installed: true, version: '0.1.0' })
    let group = wordSegmentGroup(parent)
    expect(group.querySelector('.vsidian-wordseg-status')?.textContent)
      .toBe(zhCn['wordSegment.installed'].replace('{version}', '0.1.0'))
    const buttonOf = (label: string) =>
      [...group.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!
    expect(buttonOf(zhCn['wordSegment.download']).disabled).toBe(false)
    expect(buttonOf(zhCn['wordSegment.deleteResource']).disabled).toBe(false)
    pushState(wordSegment, { installed: true, version: '0.1.0', status: 'downloading' })
    group = wordSegmentGroup(parent)
    expect(group.querySelector('.vsidian-wordseg-status')?.textContent)
      .toBe(zhCn['wordSegment.downloading'])
    const downloading = [...group.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === zhCn['wordSegment.download'])!
    expect(downloading.disabled).toBe(true)
    pushState(wordSegment, { notice: { kind: 'download-failed', detail: 'offline' } })
    group = wordSegmentGroup(parent)
    const notice = group.querySelector('.vsidian-wordseg-status ~ .vsidian-index-notice')!
    expect(notice.textContent).toBe(zhCn['wordSegment.noticeDownloadFailed'].replace('{detail}', 'offline'))
    expect(notice.className).toContain('vsidian-index-notice-warn')
  })

  it('分页切走后 wordSegment.state 推送不再重渲染（组已卸载、无悬挂写入）', () => {
    const { wordSegment, parent } = makeProductionView()
    clickNav(parent, zhCn['settings.editorCategory'])
    clickNav(parent, zhCn['settings.generalSection'])
    expect(() => pushState(wordSegment)).not.toThrow()
    expect(parent.querySelectorAll('.vsidian-wordseg-block')).toHaveLength(0)
  })
})

describe('全局搜索与兼容路由（#264）', () => {
  it('搜索「分词」命中分词条目归编辑器分组，点击进编辑器页并定位分词块', () => {
    const { parent } = makeProductionView()
    const search = parent.querySelector<HTMLInputElement>('input[type=search]')!
    search.value = zhCn['wordSegment.engineLabel'].slice(0, 2)
    search.dispatchEvent(new Event('input'))
    const result = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-result')]
      .find((b) => (b.textContent ?? '').includes(zhCn['wordSegment.engineLabel']))
    expect(result, '分词条目应命中搜索').toBeTruthy()
    expect(result!.querySelector('.vsidian-settings-result-category')?.textContent)
      .toBe(zhCn['settings.editorCategory'])
    result!.click()
    expect(groupTitles(parent)).toContain(zhCn['wordSegment.title'])
    const group = wordSegmentGroup(parent)
    const engineBlock = group.querySelector('.vsidian-wordseg-block')!
    expect(engineBlock.classList.contains('vsidian-settings-item-located')).toBe(true)
  })

  it('兼容路由（entry: engine / resource）：正文落编辑器页且对应块带定位类', () => {
    for (const entry of [WORD_SEGMENT_SECTION_ENGINE_ENTRY, WORD_SEGMENT_SECTION_RESOURCE_ENTRY]) {
      const { dispatch, parent } = makeProductionView()
      dispatch({ kind: 'settings.focusSection', section: 'wordSegment', entry })
      expect(parent.querySelector('.vsidian-settings-heading')?.textContent)
        .toBe(zhCn['settings.editorCategory'])
      const blocks = wordSegmentGroup(parent).querySelectorAll('.vsidian-wordseg-block')
      expect(blocks).toHaveLength(2)
      const target = entry === WORD_SEGMENT_SECTION_ENGINE_ENTRY ? blocks[0]! : blocks[1]!
      const other = entry === WORD_SEGMENT_SECTION_ENGINE_ENTRY ? blocks[1]! : blocks[0]!
      expect(target.classList.contains('vsidian-settings-item-located')).toBe(true)
      expect(other.classList.contains('vsidian-settings-item-located')).toBe(false)
    }
  })

  it('未知 section id 仍忽略；entries/legacySectionId 契约字段就位', () => {
    const { dispatch, wordSegment, parent } = makeProductionView()
    dispatch({ kind: 'settings.focusSection', section: 'noSuchSection' })
    expect(parent.querySelector('.vsidian-settings-heading')?.textContent)
      .toBe(zhCn['settings.generalSection'])
    expect(wordSegment.legacySectionId).toBe('wordSegment')
    expect(wordSegment.entries.map((e) => e.id))
      .toEqual([WORD_SEGMENT_SECTION_ENGINE_ENTRY, WORD_SEGMENT_SECTION_RESOURCE_ENTRY])
    expect(wordSegment.entries.every((e) => e.title.length > 0)).toBe(true)
  })
})
