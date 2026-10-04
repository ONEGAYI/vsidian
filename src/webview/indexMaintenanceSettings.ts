// 「文件与链接」设置分页（工单 #198 起为索引维护；#332 设置重组改名承接
// 文件/链接域：页内由视图装配「图片」「引用视图」两个标准设置行组
// （defsGroups），本类自有内容降为页内「索引维护」二级组——排除模式列表
// 编辑（增删行/保存/恢复默认）与缓存清理、完整重建操作（进度/取消/结果
// 反馈））。经 SettingsPageSection 注入设置页（与 CSS 片段分页同模式）；
// 状态权威在宿主（index.state 推送回显，页面不自行推断）。文案一律 t()
// 取词（indexMaintenance.* 词条）。
//
// 编辑态语义：输入框内容为**本地草稿**（draft），权威清单只在 index.state
// 到达时同步（draft 置空回落权威值）；「保存」上送非空 trim 后的清单，
// 「恢复默认」上送默认清单——两者都经宿主清洗（非法项在 notice 回显）。
import { t } from '../shared/i18n'
import { isHostToWebview } from '../shared/protocol'
import { groupIcon, type SettingsPageBridge, type SettingsPageSection } from './settingsPageView'

type IndexStateMessage = Extract<import('../shared/protocol').HostToWebview, { kind: 'index.state' }>

/** 全局搜索定位入口 id */
export const INDEX_SECTION_PATTERNS_ENTRY = 'patterns'
export const INDEX_SECTION_ACTIONS_ENTRY = 'actions'

export class IndexMaintenanceSection implements SettingsPageSection {
  readonly id = 'index'
  /** 文件夹+齿轮字形（#332 二轮：用户指定意象，自链环 glyph 换装——
   *  文件/链接域与索引维护的合体意象；一轮曾为 'links' 链环） */
  readonly icon = 'folderCog' as const
  /** #332 页内嵌标准设置行组：图片（image.*，自编辑器页迁入）与引用视图
   *  （hover.* 与 embed.* 两前缀，#298 自编辑器页迁组、#332 随分页迁移）。
   *  视图装配 h3 组容器与标准行，条目进全局搜索并归本分页分组命中；前缀
   *  过滤以视图定义表为源（本类不引用生产注册表，fixture 场景自然为空组）。
   *  #332 二轮：引用视图组标题换「手型指针+链接下划线」字形（占位链环
   *  退役，#298「正式图标后补」兑现） */
  readonly defsGroups = [
    { titleKey: 'settings.groupImage', icon: 'image' as const, prefixes: ['image.'] },
    { titleKey: 'settings.groupRefview', icon: 'pointerLink' as const, prefixes: ['hover.', 'embed.'] },
  ] as const
  // #332 改名：分页标题/描述走文件与链接词条；「索引维护」降为页内二级
  // 组标题（render 内 h3，indexMaintenance.title 词条沿用）
  get title(): string { return t('settings.filesLinksSection') }
  get description(): string { return t('settings.filesLinksSectionDescription') }

  private state: IndexStateMessage | undefined
  /** 编辑草稿（null = 跟随权威 state.patterns） */
  private draft: string[] | null = null
  private parent: HTMLElement | undefined

  constructor(private readonly bridge: SettingsPageBridge) {}

  get entries() {
    return [
      { id: INDEX_SECTION_PATTERNS_ENTRY, title: t('indexMaintenance.patternsLabel') },
      { id: INDEX_SECTION_ACTIONS_ENTRY, title: t('indexMaintenance.rebuild') },
    ]
  }

  mount(parent: HTMLElement, focusEntry?: string): () => void {
    this.parent = parent
    this.render(focusEntry)
    return () => {
      this.parent = undefined
    }
  }

  handleHostMessage(message: unknown): void {
    if (!isHostToWebview(message) || message.kind !== 'index.state') {
      return
    }
    this.state = message
    // 权威清单更新：草稿退役（含保存/恢复默认后的回显同步）
    this.draft = null
    this.render()
  }

  private send(message: object): void {
    this.bridge.postMessage(message)
  }

  private button(label: string, action: () => void, cls = ''): HTMLButtonElement {
    const el = document.createElement('button')
    el.className = cls
    el.type = 'button'
    el.textContent = label
    el.addEventListener('click', action)
    return el
  }

  /** 当前渲染用清单：草稿优先（编辑中），否则权威值 */
  private rowsOf(): string[] {
    const authoritative = this.state?.patterns ?? []
    return this.draft ?? [...authoritative, '']
  }

  private render(focusEntry?: string): void {
    const parent = this.parent
    if (!parent) {
      return
    }
    parent.replaceChildren()
    const state = this.state
    const busy = state?.status === 'cleaning' || state?.status === 'rebuilding'

    // ---- 页内二级组标题（#332：原分页降为「索引维护」组，与迁入的标准
    // 行组同一 h3 容器语言；#332 二轮换「数据库+锁链」字形，装配走
    // groupIcon 同路径） ----
    const groupTitle = document.createElement('h3')
    groupTitle.className = 'vsidian-settings-group-title'
    const glyph = groupIcon('dbLink')
    glyph.setAttribute('aria-hidden', 'true')
    groupTitle.append(glyph, document.createTextNode(t('indexMaintenance.title')))
    parent.append(groupTitle)

    // ---- 排除模式编辑 ----
    const patternsBlock = document.createElement('div')
    patternsBlock.className = 'vsidian-index-patterns'
    if (focusEntry === INDEX_SECTION_PATTERNS_ENTRY) {
      patternsBlock.classList.add('vsidian-settings-item-located')
      patternsBlock.scrollIntoView?.({ block: 'nearest' })
    }
    const patternsLabel = document.createElement('label')
    patternsLabel.className = 'vsidian-index-patterns-label'
    const caption = document.createElement('span')
    caption.className = 'vsidian-index-patterns-caption'
    caption.textContent = t('indexMaintenance.patternsLabel')
    const patternsDesc = document.createElement('span')
    patternsDesc.className = 'vsidian-index-patterns-description'
    patternsDesc.textContent = t('indexMaintenance.patternsDescription')
    patternsLabel.append(caption, patternsDesc)
    patternsBlock.append(patternsLabel)

    if (state && !state.available) {
      const unavailable = document.createElement('p')
      unavailable.className = 'vsidian-index-unavailable'
      unavailable.setAttribute('role', 'note')
      unavailable.textContent = t('indexMaintenance.unavailable')
      patternsBlock.append(unavailable)
    }

    // 模式行：输入框 + 移除按钮（草稿跟随输入；末行恒留空行便于追加）
    const list = document.createElement('div')
    list.className = 'vsidian-index-pattern-list'
    list.setAttribute('aria-label', t('indexMaintenance.patternsAriaLabel'))
    const rows = this.rowsOf()
    rows.forEach((value, index) => {
      const row = document.createElement('div')
      row.className = 'vsidian-index-pattern-row'
      const input = document.createElement('input')
      input.type = 'text'
      input.className = 'vsidian-settings-text vsidian-index-pattern-input'
      input.value = value
      input.placeholder = t('indexMaintenance.patternPlaceholder')
      input.addEventListener('input', () => this.setDraft(index, input.value))
      const remove = this.button(t('indexMaintenance.removePattern'), () => this.removeRow(index))
      remove.className = 'vsidian-index-pattern-remove'
      remove.disabled = index === rows.length - 1 && value === '' // 空尾行无需移除
      row.append(input, remove)
      list.append(row)
    })
    patternsBlock.append(list)

    const patternActions = document.createElement('div')
    patternActions.className = 'vsidian-index-pattern-actions'
    patternActions.append(
      this.button(t('indexMaintenance.addPattern'), () => this.addDraftRow()),
      this.button(t('indexMaintenance.savePatterns'), () => this.savePatterns(), 'vsidian-index-primary'),
      this.button(t('indexMaintenance.resetPatterns'), () =>
        this.send({ kind: 'index.resetPatterns' })),
    )
    patternsBlock.append(patternActions)
    parent.append(patternsBlock)

    // ---- 维护操作 ----
    const actionsBlock = document.createElement('div')
    actionsBlock.className = 'vsidian-index-actions'
    if (focusEntry === INDEX_SECTION_ACTIONS_ENTRY) {
      actionsBlock.classList.add('vsidian-settings-item-located')
      actionsBlock.scrollIntoView?.({ block: 'nearest' })
    }
    const actionsLabel = document.createElement('span')
    actionsLabel.className = 'vsidian-index-patterns-caption'
    actionsLabel.textContent = t('indexMaintenance.rebuild')
    actionsBlock.append(actionsLabel)
    const opButtons = document.createElement('div')
    opButtons.className = 'vsidian-index-pattern-actions'
    const rebuild = this.button(t('indexMaintenance.rebuild'), () =>
      this.send({ kind: 'index.rebuild' }), 'vsidian-index-primary')
    const cleanup = this.button(t('indexMaintenance.cleanup'), () =>
      this.send({ kind: 'index.cleanup' }))
    rebuild.disabled = busy || state?.available !== true
    cleanup.disabled = busy || state?.available !== true
    opButtons.append(rebuild, cleanup)
    if (busy) {
      opButtons.append(this.button(t('indexMaintenance.cancel'), () =>
        this.send({ kind: 'index.cancel' })))
    }
    actionsBlock.append(opButtons)
    // 进度（role=status：进度与结果反馈对读屏可达）
    if (state?.status === 'rebuilding') {
      const progressEl = document.createElement('p')
      progressEl.className = 'vsidian-index-progress'
      progressEl.setAttribute('role', 'status')
      progressEl.textContent = state.progress
        ? t('indexMaintenance.rebuildProgress', {
          done: String(state.progress.done),
          total: String(state.progress.total),
        })
        : t('indexMaintenance.rebuilding')
      actionsBlock.append(progressEl)
    }
    // 操作结果反馈（保留至下一次操作覆盖；宿主推送驱动）
    if (state?.notice) {
      const noticeEl = document.createElement('p')
      noticeEl.className = `vsidian-index-notice vsidian-index-notice-${noticeToneOf(state.notice.kind)}`
      noticeEl.setAttribute('role', 'status')
      noticeEl.textContent = noticeTextOf(state.notice)
      actionsBlock.append(noticeEl)
    }
    parent.append(actionsBlock)
  }

  // ---- 草稿操作（行事件驱动；重渲染保持焦点外的行值） ----

  private setDraft(index: number, value: string): void {
    const rows = this.rowsOf()
    rows[index] = value
    this.draft = rows
  }

  private addDraftRow(): void {
    const rows = this.rowsOf()
    if (rows[rows.length - 1] !== '') {
      rows.push('')
    }
    this.draft = rows
    this.render()
  }

  private removeRow(index: number): void {
    const rows = this.rowsOf()
    rows.splice(index, 1)
    if (rows.length === 0) {
      rows.push('') // 恒留一行（空行 = 待输入，保存时过滤）
    }
    this.draft = rows
    this.render()
  }

  private savePatterns(): void {
    const values = this.rowsOf()
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
    this.send({ kind: 'index.setPatterns', patterns: values })
    // 权威回显经 index.state 到达（draft 届时退役）；保存期间保持草稿
  }
}

/** notice 展示基调：失败/拒绝为警示，取消为中性，成功为常规 */
function noticeToneOf(kind: string): 'ok' | 'warn' | 'neutral' {
  if (kind === 'rebuild-failed' || kind === 'cleanup-failed' || kind === 'patterns-invalid') {
    return 'warn'
  }
  if (kind === 'rebuild-cancelled') {
    return 'neutral'
  }
  return 'ok'
}

function noticeTextOf(notice: NonNullable<IndexStateMessage['notice']>): string {
  const keyByKind: Record<typeof notice.kind, Parameters<typeof t>[0]> = {
    'patterns-saved': 'indexMaintenance.noticePatternsSaved',
    'patterns-invalid': 'indexMaintenance.noticePatternsInvalid',
    'rebuild-done': 'indexMaintenance.noticeRebuildDone',
    'rebuild-cancelled': 'indexMaintenance.noticeRebuildCancelled',
    'rebuild-failed': 'indexMaintenance.noticeRebuildFailed',
    'cleanup-done': 'indexMaintenance.noticeCleanupDone',
    'cleanup-failed': 'indexMaintenance.noticeCleanupFailed',
  }
  const key = keyByKind[notice.kind]
  return notice.detail !== undefined
    ? t(key, { detail: notice.detail, count: notice.detail })
    : t(key)
}
