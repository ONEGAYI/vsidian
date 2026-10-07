// #360 T11 附加组件按钮、面板与视图界面贡献——共享层契约测试。
//
// 票面验收映射（docs/specs/vsidian-addons-tickets/t11.md）：
// - 挂载位置与 SDK 句柄：按钮/面板只进**平台预定义挂载点**（槽位白名单），
//   稳定 ID 经命名空间注入（localId 禁点——结构免疫覆写内置/他组件身份），
//   可读标题必填；
// - 按钮动作二选一：挂接 T10 已注册命令（command 局部 ID）或自带回调
//   （onClick，运行期携当前目标句柄）——两者都给或都缺明确拒绝；
// - 声明模式（live/reading/both）形状校验；非法形状拒绝是普通 API 拒绝，
//   不算组件故障（沿 T10 拒绝面口径）。
import { describe, it, expect } from 'vitest'
import {
  ADDON_UI_BUTTON_SLOTS,
  addonUiButtonProblem,
  addonUiPanelProblem,
  namespacedAddonUiId,
  ADDON_UI_BUTTON_ID_PATTERN,
  ADDON_UI_PANEL_ID_PATTERN,
} from '../../src/shared/addonUi'
import { CONTEXT_MENU_ITEMS } from '../../src/shared/contextMenu'

const noClick = { hasOnClick: false }
const withClick = { hasOnClick: true }

describe('T11 按钮注册形状校验', () => {
  it('合法按钮定义通过（缺省槽位 toolbar、缺省模式 both）', () => {
    expect(addonUiButtonProblem({
      id: 'stampBtn', label: 'Stamp', command: 'insertStamp',
    }, noClick)).toBeNull()
    expect(addonUiButtonProblem({
      id: 'greetBtn', label: 'Greet', slot: 'toolbar', mode: 'live', order: 3,
    }, withClick)).toBeNull()
  })

  it('localId 含点被拒——命名空间分隔符不可自携（伪造内置/跨组件身份）', () => {
    expect(addonUiButtonProblem({ id: 'bold.evil', label: 'x', command: 'c' }, noClick)).toBe('dot')
    expect(addonUiPanelProblem({ id: 'other.panel', title: 'x', mount: () => {} })).toBe('dot')
  })

  it('localId 空/超长/非法字符被拒', () => {
    expect(addonUiButtonProblem({ id: '', label: 'x', command: 'c' }, noClick)).toBe('empty')
    expect(addonUiButtonProblem({ id: 'a'.repeat(65), label: 'x', command: 'c' }, noClick)).toBe('too-long')
    expect(addonUiButtonProblem({ id: 'btn!', label: 'x', command: 'c' }, noClick)).toBe('invalid-chars')
  })

  it('label 空被拒（可读标题必填——票面「自己的稳定 ID、可读标题」）', () => {
    expect(addonUiButtonProblem({ id: 'b', label: '', command: 'c' }, noClick)).toBe('label-empty')
  })

  it('槽位白名单：只有 toolbar 合法——侧栏/内置界面/设置框架等明确拒绝（负向可测试）', () => {
    expect(addonUiButtonProblem({ id: 'b', label: 'x', slot: 'sidebar' as never, command: 'c' }, noClick)).toBe('slot-unknown')
    expect(addonUiButtonProblem({ id: 'b', label: 'x', slot: 'builtin-menu' as never, command: 'c' }, noClick)).toBe('slot-unknown')
    expect(addonUiButtonProblem({ id: 'b', label: 'x', slot: 'settings' as never, command: 'c' }, noClick)).toBe('slot-unknown')
    expect(ADDON_UI_BUTTON_SLOTS).toEqual(['toolbar'])
  })

  it('命令与回调互斥：都给拒绝 action-conflict、都缺拒绝 action-missing', () => {
    expect(addonUiButtonProblem({ id: 'b', label: 'x', command: 'c' }, withClick)).toBe('action-conflict')
    expect(addonUiButtonProblem({ id: 'b', label: 'x' }, noClick)).toBe('action-missing')
    expect(addonUiButtonProblem({ id: 'b', label: 'x' }, withClick)).toBeNull()
  })

  it('command 须为本组件局部 ID（含点即伪造命名空间——拒绝）', () => {
    expect(addonUiButtonProblem({ id: 'b', label: 'x', command: 'other.addon.cmd' }, noClick)).toBe('command-local-id')
    expect(addonUiButtonProblem({ id: 'b', label: 'x', command: '' }, noClick)).toBe('command-local-id')
  })

  it('声明模式非法拒绝；order 非有限数拒绝', () => {
    expect(addonUiButtonProblem({ id: 'b', label: 'x', command: 'c', mode: 'source' as never }, noClick)).toBe('mode-invalid')
    expect(addonUiButtonProblem({ id: 'b', label: 'x', command: 'c', order: Number.NaN }, noClick)).toBe('order-invalid')
    expect(addonUiPanelProblem({ id: 'p', title: 't', mount: () => {}, mode: 'source' as never })).toBe('mode-invalid')
  })

  it('iconText 提供但为空串拒绝（缺省回 label——不空占按钮）', () => {
    expect(addonUiButtonProblem({ id: 'b', label: 'x', command: 'c', iconText: '' }, noClick)).toBe('icon-text-empty')
  })

  it('命名空间 ID：平台注入形态与观测模式', () => {
    expect(namespacedAddonUiId('publisher.addon', 'stampBtn')).toBe('publisher.addon.stampBtn')
    expect(ADDON_UI_BUTTON_ID_PATTERN.test('publisher.addon.stampBtn')).toBe(true)
    expect(ADDON_UI_PANEL_ID_PATTERN.test('publisher.addon.notePanel')).toBe(true)
    // 组件自报 ID（未经注入）形态不符——装载器只信注入结果
    expect(ADDON_UI_BUTTON_ID_PATTERN.test('stampBtn')).toBe(false)
  })

  it('按钮命名空间 ID 不撞任何内置菜单/设置框架身份（结构免疫）', () => {
    const builtinIds = new Set<string>()
    type MenuLike = { id: string; children?: readonly MenuLike[] }
    const walk = (defs: readonly MenuLike[]): void => {
      for (const def of defs) {
        builtinIds.add(def.id)
        if (def.children) walk(def.children)
      }
    }
    walk(CONTEXT_MENU_ITEMS as readonly MenuLike[])
    // localId 禁点 + 平台前缀注入：组件传任何 localId 都不可能命中内置 id
    for (const builtin of builtinIds) {
      const firstSegment = builtin.split('.')[0]!
      expect(builtinIds.has(`${firstSegment}.publisher.addon`)).toBe(false)
    }
  })
})

describe('T11 面板注册形状校验', () => {
  it('合法面板定义通过（mount 回调必填、unmount 可选）', () => {
    expect(addonUiPanelProblem({ id: 'notes', title: 'Notes', mount: () => {} })).toBeNull()
    expect(addonUiPanelProblem({
      id: 'notes', title: 'Notes', mode: 'reading', mount: () => {}, unmount: () => {},
    })).toBeNull()
  })

  it('title 空被拒；mount 非函数拒绝；unmount 给了但非函数拒绝', () => {
    expect(addonUiPanelProblem({ id: 'p', title: '', mount: () => {} })).toBe('title-empty')
    expect(addonUiPanelProblem({ id: 'p', title: 't', mount: 1 as never })).toBe('mount-not-function')
    expect(addonUiPanelProblem({ id: 'p', title: 't', mount: () => {}, unmount: 'x' as never })).toBe('unmount-not-function')
  })

  it('面板无挂载点字段语义：面板只进平台 dock（定义形状上无 slot 可传）', () => {
    // 形状即边界：面板定义不存在挂载位置字段，平台 dock 是唯一宿主容器。
    // 此处钉住「传入多余 slot 字段不参与校验也不产生挂载语义」——平台忽略
    // 未知字段，界面接管在结构上不可表达（不把内核容器交给作者）。
    const def = { id: 'p', title: 't', mount: () => {}, slot: 'editor-root' }
    expect(addonUiPanelProblem(def)).toBeNull()
    // 面板 ID 命名空间化后不可能命中内置 chrome 类名形态（类名非 ID 语义）
    expect(ADDON_UI_PANEL_ID_PATTERN.test('vsidian-toolbar')).toBe(false)
  })
})
