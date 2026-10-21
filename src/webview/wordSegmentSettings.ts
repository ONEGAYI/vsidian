// 设置页「中文分词」二级组（#239 分词分页；#264 起退役为编辑器页尾组）：
// 分词引擎选择（builtin Intl/jieba）、jieba 下载源选择（jsdelivr/npmmirror/
// 自定义 URL/本地路径）与资源下载/删除/打开目录管理。经
// SettingsPageDelegateGroup 委托装配进编辑器分页（不占侧栏分页槽位）；
// 设置值权威在宿主（settings.snapshot/changed 回显），资源状态权威在宿主
//（wordSegment.state 推送），组不自行推断。#630 local 源档下「下载」按钮
// 文案就地切换为「从本地安装」；#631 新增「打开资源目录」按钮。文案一律
// t() 取词（wordSegment.* / setting.* 词条）。
import { t } from '../shared/i18n'
import { isHostToWebview } from '../shared/protocol'
import {
  JIEBA_CUSTOM_URL_KEY,
  JIEBA_CUSTOM_URL_MAX_LENGTH,
  JIEBA_LOCAL_PATH_KEY,
  JIEBA_LOCAL_PATH_MAX_LENGTH,
  WORD_SEGMENT_ENGINE_DEFAULT,
  WORD_SEGMENT_ENGINE_KEY,
  WORD_SEGMENT_SOURCE_DEFAULT,
  WORD_SEGMENT_SOURCE_KEY,
  type SettingsPayload,
} from '../shared/settings'
import type { SettingsPageBridge, SettingsPageDelegateGroup, SettingsGroupIcon } from './settingsPageView'

type WordSegmentStateMessage = Extract<import('../shared/protocol').HostToWebview, { kind: 'wordSegment.state' }>

/** 全局搜索定位入口 id */
export const WORD_SEGMENT_SECTION_ENGINE_ENTRY = 'engine'
export const WORD_SEGMENT_SECTION_RESOURCE_ENTRY = 'resource'

export class WordSegmentSection implements SettingsPageDelegateGroup {
  /** 组标题语言键（编辑器页内 h3 二级标题，复用原分词分页标题词条） */
  readonly titleKey = 'wordSegment.title' as const
  /** #264 兼容路由：宿主按退役分页 id 发起 settings.focusSection 时路由
   *  回编辑器页本组（openWithSection 通道对外行为不变） */
  readonly legacySectionId = 'wordSegment'
  /** #265 生图接线：组标题图标槽位登记——分词 A 方案生图资产（明暗两套
   *  SVG 经 .vsidian-settings-generated-icon 按主题加载），走与 defs 组
   *  同一 h3 容器路径 */
  readonly icon: SettingsGroupIcon = 'wordSegment'

  private values: SettingsPayload | undefined
  private resourceState: WordSegmentStateMessage | undefined
  private parent: HTMLElement | undefined

  constructor(private readonly bridge: SettingsPageBridge) {}

  get entries() {
    return [
      { id: WORD_SEGMENT_SECTION_ENGINE_ENTRY, title: t('wordSegment.engineLabel') },
      { id: WORD_SEGMENT_SECTION_RESOURCE_ENTRY, title: t('wordSegment.resourceLabel') },
    ]
  }

  mount(parent: HTMLElement, focusEntry?: string): (() => void) | undefined {
    this.parent = parent
    this.render(focusEntry)
    return () => {
      this.parent = undefined
    }
  }

  handleHostMessage(message: unknown): void {
    if (!isHostToWebview(message)) return
    if (message.kind === 'wordSegment.state') {
      this.resourceState = message
      this.render()
      return
    }
    if (message.kind === 'settings.snapshot' || message.kind === 'settings.changed') {
      this.values = message.values
      // 就地同步不重建：整组重建会丢定位类与用户焦点（定位态下任一设置
      // 保存广播即触发本路径）——标准设置行的回显同为就地同步语义
      this.syncSettingValues()
    }
  }

  /** 设置值权威回显的就地同步：引擎/下载源 radio 选中态与灰化、自定义
   *  URL 与本地路径输入值与禁用态、下载/安装按钮文案与进行中状态文本。
   *  资源状态块不受 settings.* 影响时仅同步这些源档位相关文本（资源块
   *  整重建由 wordSegment.state 触发），定位类与焦点原样保留。灰化口径
   *  与 render 一致：下载源四行只随 engine 非 jieba 禁用，custom/local
   *  输入框另在下载源非对应档时禁用 */
  private syncSettingValues(): void {
    const parent = this.parent
    if (!parent) return
    const engine = this.valueOf(WORD_SEGMENT_ENGINE_KEY, WORD_SEGMENT_ENGINE_DEFAULT)
    const source = this.valueOf(WORD_SEGMENT_SOURCE_KEY, WORD_SEGMENT_SOURCE_DEFAULT)
    const sourceDisabled = engine !== 'jieba'
    for (const radio of parent.querySelectorAll<HTMLInputElement>('input[type=radio][name^="wordseg-"]')) {
      const key = radio.name.slice('wordseg-'.length)
      radio.checked = radio.value === this.valueOf(key, '')
      if (key === WORD_SEGMENT_SOURCE_KEY) {
        radio.disabled = sourceDisabled
      }
    }
    const customInput = parent.querySelector<HTMLInputElement>('input.vsidian-wordseg-custom-url')
    if (customInput) {
      customInput.value = this.valueOf(JIEBA_CUSTOM_URL_KEY, '')
      customInput.disabled = sourceDisabled || source !== 'custom'
    }
    const localInput = parent.querySelector<HTMLInputElement>('input.vsidian-wordseg-local-path')
    if (localInput) {
      localInput.value = this.valueOf(JIEBA_LOCAL_PATH_KEY, '')
      localInput.disabled = sourceDisabled || source !== 'local'
    }
    // 源档位相关文案就地同步（资源块只在 wordSegment.state 时重建，档位
    // 切换不触发重建——按钮与进行中文案须随 settings.changed 更新）
    const downloadButton = parent.querySelector<HTMLButtonElement>('button.vsidian-wordseg-download')
    if (downloadButton) {
      downloadButton.textContent = this.actionLabel(source)
    }
    const statusEl = parent.querySelector<HTMLElement>('.vsidian-wordseg-status')
    if (statusEl && this.resourceState?.status === 'downloading') {
      statusEl.textContent = this.busyText(source)
    }
  }

  /** 资源获取动作文案：local 档是本地安装，网络档是下载 */
  private actionLabel(source: string): string {
    return source === 'local' ? t('wordSegment.installLocal') : t('wordSegment.download')
  }

  /** 资源获取进行中文案：local 档读本地路径，网络档走网络下载 */
  private busyText(source: string): string {
    return source === 'local' ? t('wordSegment.installing') : t('wordSegment.downloading')
  }

  private send(message: object): void {
    this.bridge.postMessage(message)
  }

  /** 保存单个设置键（标准设置保存链路：宿主校验持久化后广播回显） */
  private setSetting(key: string, value: string): void {
    this.send({ kind: 'settings.set', values: { [key]: value } })
  }

  private valueOf(key: string, fallback: string): string {
    const raw = this.values?.[key]
    return typeof raw === 'string' ? raw : fallback
  }

  private button(label: string, action: () => void, cls = ''): HTMLButtonElement {
    const el = document.createElement('button')
    el.className = cls
    el.type = 'button'
    el.textContent = label
    el.addEventListener('click', action)
    return el
  }

  /** 组内块定位（引擎/资源两处同形）：focusEntry 命中条目 id 时加定位类
   *  并滚动到位。定位在入文档后执行：游离节点上 scrollIntoView 是 no-op
   *（renderDefItems 同款约束——容器先入文档、条目再定位） */
  private locateBlock(block: HTMLElement, focusEntry: string | undefined, entryId: string): void {
    if (focusEntry !== entryId) return
    block.classList.add('vsidian-settings-item-located')
    block.scrollIntoView?.({ block: 'nearest' })
  }

  private render(focusEntry?: string): void {
    const parent = this.parent
    if (!parent) return
    // #264 组容器归设置页视图所有（h3 组标题同住容器内）：render 只替换
    // 本组的两块内容，不清空容器——原分页形态的整容器 replaceChildren
    // 会连带清掉组标题
    parent.querySelectorAll(':scope > .vsidian-wordseg-block').forEach((el) => el.remove())
    const state = this.resourceState
    const busy = state?.status === 'downloading'
    const engine = this.valueOf(WORD_SEGMENT_ENGINE_KEY, WORD_SEGMENT_ENGINE_DEFAULT)
    const source = this.valueOf(WORD_SEGMENT_SOURCE_KEY, WORD_SEGMENT_SOURCE_DEFAULT)
    const customUrl = this.valueOf(JIEBA_CUSTOM_URL_KEY, '')

    // ---- 引擎与下载源 ----
    const engineBlock = document.createElement('div')
    engineBlock.className = 'vsidian-wordseg-block'
    const engineLabel = document.createElement('label')
    engineLabel.className = 'vsidian-wordseg-label'
    const caption = document.createElement('span')
    caption.className = 'vsidian-wordseg-caption'
    caption.textContent = t('wordSegment.engineLabel')
    const engineDesc = document.createElement('span')
    engineDesc.className = 'vsidian-wordseg-description'
    engineDesc.textContent = t('wordSegment.engineDescription')
    engineLabel.append(caption, engineDesc)
    engineBlock.append(engineLabel)
    engineBlock.append(
      this.optionRow(WORD_SEGMENT_ENGINE_KEY, 'builtin', engine, t('setting.wordSegmentEngineBuiltin'), t('wordSegment.engineBuiltinHint')),
      this.optionRow(WORD_SEGMENT_ENGINE_KEY, 'jieba', engine, t('setting.wordSegmentEngineJieba'), t('wordSegment.engineJiebaHint')),
    )

    const sourceCaption = document.createElement('span')
    sourceCaption.className = 'vsidian-wordseg-caption'
    sourceCaption.textContent = t('wordSegment.sourceLabel')
    const sourceDesc = document.createElement('span')
    sourceDesc.className = 'vsidian-wordseg-description'
    sourceDesc.textContent = t('wordSegment.sourceDescription')
    const sourceLabel = document.createElement('label')
    sourceLabel.className = 'vsidian-wordseg-label'
    sourceLabel.append(sourceCaption, sourceDesc)
    engineBlock.append(sourceLabel)
    const sourceDisabled = engine !== 'jieba'
    engineBlock.append(
      this.optionRow(WORD_SEGMENT_SOURCE_KEY, 'jsdelivr', source, t('setting.wordSegmentSourceJsdelivr'), undefined, sourceDisabled),
      this.optionRow(WORD_SEGMENT_SOURCE_KEY, 'npmmirror', source, t('setting.wordSegmentSourceNpmmirror'), undefined, sourceDisabled),
      this.optionRow(WORD_SEGMENT_SOURCE_KEY, 'custom', source, t('setting.wordSegmentSourceCustom'), undefined, sourceDisabled),
      this.optionRow(WORD_SEGMENT_SOURCE_KEY, 'local', source, t('setting.wordSegmentSourceLocal'), undefined, sourceDisabled),
    )
    const customRow = document.createElement('div')
    customRow.className = 'vsidian-wordseg-custom-row'
    const customInput = document.createElement('input')
    customInput.type = 'text'
    customInput.className = 'vsidian-settings-text vsidian-wordseg-custom-url'
    customInput.value = customUrl
    customInput.placeholder = t('wordSegment.customUrlPlaceholder')
    customInput.setAttribute('aria-label', t('setting.wordSegmentCustomUrl.title'))
    customInput.maxLength = JIEBA_CUSTOM_URL_MAX_LENGTH
    customInput.disabled = sourceDisabled || source !== 'custom'
    // 本地草稿即时感：输入不逐键上送（change 提交），权威回显经
    // settings.changed 到达后整页重渲染对齐
    customInput.addEventListener('change', () => {
      if (customInput.value.trim() !== customUrl) {
        this.setSetting(JIEBA_CUSTOM_URL_KEY, customInput.value.trim())
      }
    })
    customRow.append(customInput)
    engineBlock.append(customRow)
    // #630 local 源路径输入（目录或 .tgz 文件；宿主侧解析，Remote SSH 为
    // 远程机路径——placeholder 与设置描述写明）
    const localPath = this.valueOf(JIEBA_LOCAL_PATH_KEY, '')
    const localRow = document.createElement('div')
    localRow.className = 'vsidian-wordseg-custom-row'
    const localInput = document.createElement('input')
    localInput.type = 'text'
    localInput.className = 'vsidian-settings-text vsidian-wordseg-local-path'
    localInput.value = localPath
    localInput.placeholder = t('wordSegment.localPathPlaceholder')
    localInput.setAttribute('aria-label', t('setting.wordSegmentLocalPath.title'))
    localInput.maxLength = JIEBA_LOCAL_PATH_MAX_LENGTH
    localInput.disabled = sourceDisabled || source !== 'local'
    localInput.addEventListener('change', () => {
      if (localInput.value.trim() !== localPath) {
        this.setSetting(JIEBA_LOCAL_PATH_KEY, localInput.value.trim())
      }
    })
    localRow.append(localInput)
    engineBlock.append(localRow)
    parent.append(engineBlock)
    this.locateBlock(engineBlock, focusEntry, WORD_SEGMENT_SECTION_ENGINE_ENTRY)

    // ---- 资源管理 ----
    const resourceBlock = document.createElement('div')
    resourceBlock.className = 'vsidian-wordseg-block'
    const resourceCaption = document.createElement('span')
    resourceCaption.className = 'vsidian-wordseg-caption'
    resourceCaption.textContent = t('wordSegment.resourceLabel')
    const resourceDesc = document.createElement('span')
    resourceDesc.className = 'vsidian-wordseg-description'
    resourceDesc.textContent = t('wordSegment.resourceDescription')
    const resourceLabel = document.createElement('label')
    resourceLabel.className = 'vsidian-wordseg-label'
    resourceLabel.append(resourceCaption, resourceDesc)
    resourceBlock.append(resourceLabel)

    const statusEl = document.createElement('p')
    statusEl.className = 'vsidian-wordseg-status'
    statusEl.setAttribute('role', 'status')
    if (busy) {
      statusEl.textContent = this.busyText(source)
    } else if (state?.installed) {
      statusEl.textContent = t('wordSegment.installed', { version: state.version })
    } else {
      statusEl.textContent = t('wordSegment.notInstalled')
    }
    resourceBlock.append(statusEl)

    const actions = document.createElement('div')
    actions.className = 'vsidian-wordseg-actions'
    const download = this.button(this.actionLabel(source), () =>
      this.send({ kind: 'wordSegment.download' }), 'vsidian-index-primary vsidian-wordseg-download')
    download.disabled = busy
    const remove = this.button(t('wordSegment.deleteResource'), () =>
      this.send({ kind: 'wordSegment.delete' }))
    remove.disabled = busy || state?.installed !== true
    // #631 打开资源目录（分享/备份入口）：installed 时才可点——未安装时
    // 版本目录不存在，revealFileInOS 无处可开
    const openDir = this.button(t('wordSegment.openDirectory'), () =>
      this.send({ kind: 'wordSegment.openDirectory' }))
    openDir.disabled = busy || state?.installed !== true
    actions.append(download, remove, openDir)
    resourceBlock.append(actions)

    if (state?.notice) {
      const noticeEl = document.createElement('p')
      noticeEl.className = `vsidian-index-notice vsidian-index-notice-${noticeTone(state.notice.kind)}`
      noticeEl.setAttribute('role', 'status')
      noticeEl.textContent = noticeText(state.notice)
      resourceBlock.append(noticeEl)
    }
    parent.append(resourceBlock)
    this.locateBlock(resourceBlock, focusEntry, WORD_SEGMENT_SECTION_RESOURCE_ENTRY)
  }

  /** 单选行：radio + 名称（+ 可选说明）；点击即保存该键值 */
  private optionRow(
    key: string,
    value: string,
    current: string,
    label: string,
    hint?: string,
    disabled = false,
  ): HTMLElement {
    const row = document.createElement('label')
    row.className = 'vsidian-wordseg-option'
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = `wordseg-${key}`
    input.value = value
    input.checked = current === value
    input.disabled = disabled
    input.addEventListener('change', () => {
      if (input.checked) this.setSetting(key, value)
    })
    const text = document.createElement('span')
    text.className = 'vsidian-wordseg-option-text'
    const name = document.createElement('span')
    name.textContent = label
    text.append(name)
    if (hint) {
      const hintEl = document.createElement('span')
      hintEl.className = 'vsidian-wordseg-option-hint'
      hintEl.textContent = hint
      text.append(hintEl)
    }
    row.append(input, text)
    return row
  }
}

/** notice 展示基调：成功（下载/安装/删除）为常规，失败与加载失败警示 */
function noticeTone(kind: string): 'ok' | 'warn' {
  return kind === 'downloaded' || kind === 'installed' || kind === 'deleted' ? 'ok' : 'warn'
}

function noticeText(notice: NonNullable<WordSegmentStateMessage['notice']>): string {
  const keyByKind: Record<typeof notice.kind, Parameters<typeof t>[0]> = {
    downloaded: 'wordSegment.noticeDownloaded',
    'download-failed': 'wordSegment.noticeDownloadFailed',
    installed: 'wordSegment.noticeInstalled',
    'install-failed': 'wordSegment.noticeInstallFailed',
    deleted: 'wordSegment.noticeDeleted',
    'delete-failed': 'wordSegment.noticeDeleteFailed',
    'load-failed': 'wordSegment.noticeLoadFailed',
  }
  return t(keyByKind[notice.kind], notice.detail === undefined ? {} : { detail: notice.detail })
}
