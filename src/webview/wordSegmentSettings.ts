// 设置页「中文分词」分页（#239）：分词引擎选择（builtin Intl/jieba）、
// jieba 下载源选择（jsdelivr/npmmirror/自定义 URL）与资源下载/删除管理。
// 经 SettingsPageSection 注入设置页（与索引维护分页同模式）；设置值权威
// 在宿主（settings.snapshot/changed 回显），资源状态权威在宿主
//（wordSegment.state 推送），页面不自行推断。文案一律 t() 取词
//（wordSegment.* / setting.* 词条）。
import { t } from '../shared/i18n'
import { isHostToWebview } from '../shared/protocol'
import {
  JIEBA_CUSTOM_URL_KEY,
  JIEBA_CUSTOM_URL_MAX_LENGTH,
  WORD_SEGMENT_ENGINE_DEFAULT,
  WORD_SEGMENT_ENGINE_KEY,
  WORD_SEGMENT_SOURCE_DEFAULT,
  WORD_SEGMENT_SOURCE_KEY,
  type SettingsPayload,
} from '../shared/settings'
import type { SettingsPageBridge, SettingsPageSection } from './settingsPageView'

type WordSegmentStateMessage = Extract<import('../shared/protocol').HostToWebview, { kind: 'wordSegment.state' }>

/** 全局搜索定位入口 id */
export const WORD_SEGMENT_SECTION_ENGINE_ENTRY = 'engine'
export const WORD_SEGMENT_SECTION_RESOURCE_ENTRY = 'resource'

export class WordSegmentSection implements SettingsPageSection {
  readonly id = 'wordSegment'
  readonly icon = 'keyboard' as const
  get title(): string { return t('wordSegment.title') }
  get description(): string { return t('wordSegment.description') }

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
      this.render()
    }
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

  private render(focusEntry?: string): void {
    const parent = this.parent
    if (!parent) return
    parent.replaceChildren()
    const state = this.resourceState
    const busy = state?.status === 'downloading'
    const engine = this.valueOf(WORD_SEGMENT_ENGINE_KEY, WORD_SEGMENT_ENGINE_DEFAULT)
    const source = this.valueOf(WORD_SEGMENT_SOURCE_KEY, WORD_SEGMENT_SOURCE_DEFAULT)
    const customUrl = this.valueOf(JIEBA_CUSTOM_URL_KEY, '')

    // ---- 引擎与下载源 ----
    const engineBlock = document.createElement('div')
    engineBlock.className = 'vsidian-wordseg-block'
    if (focusEntry === WORD_SEGMENT_SECTION_ENGINE_ENTRY) {
      engineBlock.classList.add('vsidian-settings-item-located')
      engineBlock.scrollIntoView?.({ block: 'nearest' })
    }
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
    parent.append(engineBlock)

    // ---- 资源管理 ----
    const resourceBlock = document.createElement('div')
    resourceBlock.className = 'vsidian-wordseg-block'
    if (focusEntry === WORD_SEGMENT_SECTION_RESOURCE_ENTRY) {
      resourceBlock.classList.add('vsidian-settings-item-located')
      resourceBlock.scrollIntoView?.({ block: 'nearest' })
    }
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
      statusEl.textContent = t('wordSegment.downloading')
    } else if (state?.installed) {
      statusEl.textContent = t('wordSegment.installed', { version: state.version })
    } else {
      statusEl.textContent = t('wordSegment.notInstalled')
    }
    resourceBlock.append(statusEl)

    const actions = document.createElement('div')
    actions.className = 'vsidian-wordseg-actions'
    const download = this.button(t('wordSegment.download'), () =>
      this.send({ kind: 'wordSegment.download' }), 'vsidian-index-primary')
    download.disabled = busy
    const remove = this.button(t('wordSegment.deleteResource'), () =>
      this.send({ kind: 'wordSegment.delete' }))
    remove.disabled = busy || state?.installed !== true
    actions.append(download, remove)
    resourceBlock.append(actions)

    if (state?.notice) {
      const noticeEl = document.createElement('p')
      noticeEl.className = `vsidian-index-notice vsidian-index-notice-${noticeTone(state.notice.kind)}`
      noticeEl.setAttribute('role', 'status')
      noticeEl.textContent = noticeText(state.notice)
      resourceBlock.append(noticeEl)
    }
    parent.append(resourceBlock)
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

/** notice 展示基调：失败为警示，成功为常规，加载失败警示 */
function noticeTone(kind: string): 'ok' | 'warn' {
  return kind === 'downloaded' || kind === 'deleted' ? 'ok' : 'warn'
}

function noticeText(notice: NonNullable<WordSegmentStateMessage['notice']>): string {
  const keyByKind: Record<typeof notice.kind, Parameters<typeof t>[0]> = {
    downloaded: 'wordSegment.noticeDownloaded',
    'download-failed': 'wordSegment.noticeDownloadFailed',
    deleted: 'wordSegment.noticeDeleted',
    'delete-failed': 'wordSegment.noticeDeleteFailed',
    'load-failed': 'wordSegment.noticeLoadFailed',
  }
  return t(keyByKind[notice.kind], notice.detail === undefined ? {} : { detail: notice.detail })
}
