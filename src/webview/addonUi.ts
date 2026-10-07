// #360 T11 附加组件界面运行时（webview 编辑器页，纯 DOM 面——不含 CM6）。
//
// 职责（票面 #360 / ADR-0012 运行与作用范围）：
// - SDK 注册面后端：sdk.ui.registerButton / sdk.ui.registerPanel 的校验、
//   命名空间注入、DOM 挂载与句柄分发；
// - 挂载归属：按钮只进平台工具栏槽容器（.vsidian-addon-toolbar-slot）、
//   面板只进平台 dock（.vsidian-addon-panel-dock）——不把内核容器或整
//   编辑器交给作者接管；组件内容根（面板 body 内 root）内部样式归组件，
//   挂载点容器与面板 chrome（标题栏/关闭按钮）样式归平台；
// - 目标路由：按钮回调与面板 target() 携**当前活动视图句柄**（焦点所在
//   嵌入内部 Live → B；否则主正文 A——T06 句柄语义，在引用 B 中操作归 B
//   不误改父 A）；
// - 回收矩阵：dispose（单条）、applyMode（模式不符按钮撤挂/面板强制关闭，
//   注册保留）、releaseAddon（停用/故障整组件回收，本页闭环）；
// - 迟到结果：面板关闭即容器移除、内容根脱挂——组件迟到的 DOM 写入结构
//   上不可见；
// - 异常边界：onClick/mount/unmount 异常本地吞掉留痕（键路由与用户交互
//   不因组件代码断链）；mount 异常面板回收并移除注册（不留半装配——
//   ADR「异常恢复」的界面侧子集）；全组件故障暂停仍由装载器工厂路径与
//   宿主 runtime 承担，运行期回调异常不升级。
import {
  addonUiButtonProblem,
  addonUiPanelProblem,
  namespacedAddonUiId,
  type AddonUiButtonDefinition,
  type AddonUiPanelDefinition,
  type AddonUiTargetGetter,
} from '../shared/addonUi'
import type { BindingMode } from '../shared/keybindings'
import type { AddonViewHandle } from '../shared/addonEditApi'

/** 运行时环境（main.ts 构造注入；vscode/CM6 不进本模块——jsdom 可测） */
export interface AddonUiRuntimeEnv {
  /** 平台工具栏附加组件槽容器（空态 CSS 零占位；常驻 DOM 供探针命中） */
  toolbarSlot: HTMLElement
  /** 平台面板 dock 容器（主编辑区尾部；空态 CSS 零占位） */
  panelDock: HTMLElement
  /** 当前视图模式（注册与模式切换时的挂载判定） */
  currentMode(): 'live' | 'reading'
  /** 当前活动视图实例 ID（焦点嵌入内部 Live → embed 键；否则 'main'；
   *  无可用视图 null） */
  activeInstanceId(): string | null
  /** 按组件身份构造视图句柄（装载器同源构造——含代次存活与 opId 分配；
   *  实例不在场 null） */
  makeHandle(addonId: string, instanceId: string): AddonViewHandle | null
  /** 命令路径执行（controller.runAddonCommand——模式复核后的组件回调） */
  executeCommand(commandId: string): boolean
  /** 挂接命令的生效绑定（键位徽章数据；空数组 = 未绑定） */
  bindingHints(commandId: string): readonly string[]
  /** 面板关闭按钮的平台文案（i18n） */
  panelCloseLabel(): string
  /** 归因日志（拒绝与回调异常留痕） */
  log?: (detail: string) => void
}

/** SDK 按钮注册返回句柄 */
export interface AddonUiButtonOutcome {
  ok: boolean
  reason?: string
  /** 命名空间按钮 ID（ok 时给出） */
  id?: string
  dispose(): void
}

/** SDK 面板注册返回句柄（开闭控制归组件；dispose 后全部拒绝） */
export interface AddonUiPanelOutcome extends AddonUiButtonOutcome {
  open(): boolean
  close(): boolean
  isOpen(): boolean
}

/** 观测快照（paint 探针与测试的序列化面） */
export interface AddonUiStats {
  buttons: Array<{ id: string; addonId: string; mounted: boolean }>
  panels: Array<{ id: string; addonId: string; open: boolean }>
}

interface ButtonEntry {
  addonId: string
  generation: number
  def: AddonUiButtonDefinition
  buttonId: string
  commandId?: string
  onClick?: (target: AddonViewHandle | null) => void
  /** 注册序（同 order 稳定排序键） */
  seq: number
  el: HTMLButtonElement | null
}

interface PanelEntry {
  addonId: string
  generation: number
  def: AddonUiPanelDefinition
  panelId: string
  seq: number
  open: boolean
  /** 打开时的面板容器（关闭即移除并置 null） */
  container: HTMLElement | null
  /** 打开时的组件内容根（脱挂后组件迟到写入不可见） */
  root: HTMLElement | null
}

function modeAllows(declared: BindingMode | undefined, current: 'live' | 'reading'): boolean {
  if (declared === undefined || declared === 'both') {
    return true
  }
  return declared === current
}

export class AddonUiRuntime {
  private readonly buttons = new Map<string, ButtonEntry>()
  private readonly panels = new Map<string, PanelEntry>()
  private letSeq = 0

  constructor(private readonly env: AddonUiRuntimeEnv) {}

  /** SDK ui.registerButton 后端：校验 → 存管 → 模式匹配即挂载 */
  registerButton(
    addonId: string,
    generation: number,
    def: AddonUiButtonDefinition,
    onClick?: (target: AddonViewHandle | null) => void,
  ): AddonUiButtonOutcome {
    const reject = (reason: string): AddonUiButtonOutcome => {
      this.env.log?.(`addon ${addonId} ui-button-register rejected: ${reason}`)
      return { ok: false, reason, dispose: () => {} }
    }
    const problem = addonUiButtonProblem(def, { hasOnClick: typeof onClick === 'function' })
    if (problem !== null) {
      return reject(`button:${problem}`)
    }
    if (onClick !== undefined && typeof onClick !== 'function') {
      return reject('button:handler-not-function')
    }
    const buttonId = namespacedAddonUiId(addonId, def.id)
    if (this.buttons.has(buttonId)) {
      return reject('duplicate-button')
    }
    const entry: ButtonEntry = {
      addonId,
      generation,
      def,
      buttonId,
      ...(def.command !== undefined ? { commandId: namespacedAddonUiId(addonId, def.command) } : {}),
      ...(onClick !== undefined ? { onClick } : {}),
      seq: ++this.letSeq,
      el: null,
    }
    this.buttons.set(buttonId, entry)
    if (modeAllows(def.mode, this.env.currentMode())) {
      this.mountButton(entry)
    }
    return {
      ok: true,
      id: buttonId,
      dispose: () => {
        if (this.buttons.get(buttonId)?.generation !== generation) {
          return
        }
        this.buttons.delete(buttonId)
        this.unmountButton(entry)
      },
    }
  }

  /** SDK ui.registerPanel 后端：校验 → 存管（默认关闭；open 时构造 chrome） */
  registerPanel(addonId: string, generation: number, def: AddonUiPanelDefinition): AddonUiPanelOutcome {
    const reject = (reason: string): AddonUiPanelOutcome => {
      this.env.log?.(`addon ${addonId} ui-panel-register rejected: ${reason}`)
      return { ok: false, reason, dispose: () => {}, open: () => false, close: () => false, isOpen: () => false }
    }
    const problem = addonUiPanelProblem(def)
    if (problem !== null) {
      return reject(`panel:${problem}`)
    }
    const panelId = namespacedAddonUiId(addonId, def.id)
    if (this.panels.has(panelId)) {
      return reject('duplicate-panel')
    }
    const entry: PanelEntry = {
      addonId,
      generation,
      def,
      panelId,
      seq: ++this.letSeq,
      open: false,
      container: null,
      root: null,
    }
    this.panels.set(panelId, entry)
    const isCurrent = (): boolean => this.panels.get(panelId) === entry
    return {
      ok: true,
      id: panelId,
      isOpen: () => isCurrent() && entry.open,
      open: () => {
        if (!isCurrent() || entry.open) {
          return false
        }
        return this.openPanel(entry)
      },
      close: () => {
        if (!isCurrent() || !entry.open) {
          return false
        }
        this.closePanel(entry)
        return true
      },
      dispose: () => {
        if (!isCurrent()) {
          return
        }
        this.panels.delete(panelId)
        if (entry.open) {
          this.closePanel(entry)
        }
      },
    }
  }

  /** 模式切换（controller applyModeDom 通知）：不符按钮撤挂（注册保留，
   *  切回重挂）、不符面板强制关闭（挂载与监听回收） */
  applyMode(mode: 'live' | 'reading'): void {
    for (const entry of this.buttons.values()) {
      if (modeAllows(entry.def.mode, mode)) {
        if (entry.el === null) {
          this.mountButton(entry)
        }
      } else if (entry.el !== null) {
        this.unmountButton(entry)
      }
    }
    for (const entry of [...this.panels.values()]) {
      if (entry.open && !modeAllows(entry.def.mode, mode)) {
        this.closePanel(entry)
      }
    }
  }

  /** 整组件回收（装载器 releaseLoad：停用/故障/代次释放）——撤按钮、关
   *  面板、清注册；本页闭环，不依赖宿主消息到达 */
  releaseAddon(addonId: string): void {
    for (const [buttonId, entry] of [...this.buttons]) {
      if (entry.addonId === addonId) {
        this.buttons.delete(buttonId)
        this.unmountButton(entry)
      }
    }
    for (const [panelId, entry] of [...this.panels]) {
      if (entry.addonId === addonId) {
        this.panels.delete(panelId)
        if (entry.open) {
          this.closePanel(entry)
        }
      }
    }
  }

  /** 观测快照（paint 探针数据源） */
  stats(): AddonUiStats {
    return {
      buttons: [...this.buttons.values()].map((entry) => ({
        id: entry.buttonId,
        addonId: entry.addonId,
        mounted: entry.el !== null,
      })),
      panels: [...this.panels.values()].map((entry) => ({
        id: entry.panelId,
        addonId: entry.addonId,
        open: entry.open,
      })),
    }
  }

  // ---- 按钮挂载 ----

  private mountButton(entry: ButtonEntry): void {
    const def = entry.def
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'vsidian-addon-toolbar-button'
    button.dataset['addonButton'] = entry.buttonId
    button.setAttribute('aria-label', def.label)
    // #300 悬停词：data-tooltip 承载（组件文案自由文本——不进内置字典）；
    // 命令按钮的键位徽章走结构化 data-tooltip-keys（不文字缀尾）
    button.setAttribute('data-tooltip', def.label)
    if (entry.commandId !== undefined) {
      const keys = this.env.bindingHints(entry.commandId)
      if (keys.length > 0) {
        button.setAttribute('data-tooltip-keys', keys.join('\n'))
      }
    }
    button.textContent = def.iconText ?? def.label
    button.addEventListener('click', () => this.onButtonClick(entry))
    entry.el = button
    this.placeButton(entry)
  }

  /** 槽内定位：order 升序稳定排序（缺省 0；同序按注册序） */
  private placeButton(entry: ButtonEntry): void {
    const el = entry.el
    if (el === null) {
      return
    }
    const slot = this.env.toolbarSlot
    const siblings = [...this.buttons.values()]
      .filter((other) => other.el !== null && other !== entry)
      .sort((a, b) => (a.def.order ?? 0) - (b.def.order ?? 0) || a.seq - b.seq)
    const next = siblings.find(
      (other) => (other.def.order ?? 0) > (entry.def.order ?? 0) ||
        ((other.def.order ?? 0) === (entry.def.order ?? 0) && other.seq > entry.seq),
    )
    if (next?.el) {
      slot.insertBefore(el, next.el)
    } else {
      slot.appendChild(el)
    }
  }

  private unmountButton(entry: ButtonEntry): void {
    entry.el?.remove()
    entry.el = null
  }

  private onButtonClick(entry: ButtonEntry): void {
    if (entry.commandId !== undefined) {
      // 命令路径：经命令体系执行（模式复核复用 T10 链路；模式不符按钮
      // 本就不挂载，双保险）
      this.env.executeCommand(entry.commandId)
      return
    }
    try {
      entry.onClick?.(this.resolveTargetFor(entry.addonId))
    } catch (err) {
      // 组件回调异常不外溢（不阻断平台交互链）；可归因故障升级归装载器
      // 工厂路径与宿主 runtime
      this.env.log?.(`addon ${entry.addonId} ui-button ${entry.buttonId} onClick error: ${String(err)}`)
    }
  }

  private resolveTargetFor(addonId: string): AddonViewHandle | null {
    const instanceId = this.env.activeInstanceId()
    if (instanceId === null) {
      return null
    }
    return this.env.makeHandle(addonId, instanceId)
  }

  // ---- 面板开闭 ----

  private openPanel(entry: PanelEntry): boolean {
    if (!modeAllows(entry.def.mode, this.env.currentMode())) {
      // 声明模式不符（如 live 面板在阅读态）：打开请求拒绝——面板挂载
      // 不得越过模式声明
      this.env.log?.(`addon ${entry.addonId} ui-panel ${entry.panelId} open rejected: mode`)
      return false
    }
    const container = document.createElement('section')
    container.className = 'vsidian-addon-panel'
    container.dataset['addonPanel'] = entry.panelId
    const header = document.createElement('div')
    header.className = 'vsidian-addon-panel-header'
    const title = document.createElement('span')
    title.className = 'vsidian-addon-panel-title'
    title.textContent = entry.def.title
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'vsidian-addon-panel-close'
    close.setAttribute('aria-label', this.env.panelCloseLabel())
    close.setAttribute('data-tooltip', this.env.panelCloseLabel())
    close.addEventListener('click', () => {
      // 用户关闭路径（与组件 close() 同一收口；面板注册可能已被释放——
      // closePanel 前置 open 判定兜底）
      if (entry.open) {
        this.closePanel(entry)
      }
    })
    header.append(title, close)
    const body = document.createElement('div')
    body.className = 'vsidian-addon-panel-body'
    container.append(header, body)
    const root = document.createElement('div')
    root.className = 'vsidian-addon-panel-root'
    root.dataset['addonRoot'] = entry.panelId
    body.appendChild(root)
    const target: AddonUiTargetGetter = () => this.resolveTargetFor(entry.addonId)
    entry.container = container
    entry.root = root
    entry.open = true
    this.env.panelDock.appendChild(container)
    try {
      entry.def.mount(root, target)
    } catch (err) {
      // mount 异常：面板回收不留半装配，注册移除（重复释放无害）
      this.env.log?.(`addon ${entry.addonId} ui-panel ${entry.panelId} mount error: ${String(err)}`)
      this.closePanel(entry)
      if (this.panels.get(entry.panelId) === entry) {
        this.panels.delete(entry.panelId)
      }
      return false
    }
    return true
  }

  private closePanel(entry: PanelEntry): void {
    if (entry.container !== null && entry.root !== null) {
      try {
        entry.def.unmount?.(entry.root)
      } catch (err) {
        this.env.log?.(`addon ${entry.addonId} ui-panel ${entry.panelId} unmount error: ${String(err)}`)
      }
    }
    // 容器移除即内容根脱挂：组件迟到的 DOM 写入结构上不可见（迟到结果
    // 不进失效面板的平台保证）
    entry.container?.remove()
    entry.container = null
    entry.root = null
    entry.open = false
  }
}
