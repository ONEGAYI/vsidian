// @vitest-environment jsdom
// #474 积木式查询构造器（BehaviorQueryBuilder）——编辑交互契约：加号下拉
// 三组与新建、字段/状态就地编辑上抛、选中发光范围、垃圾桶三用法、键盘
// 构建（Enter 拾取/方向键选缺口/Enter 放下/Esc 取消/Delete 删除）、块数
// 上限禁用。事实源 src/webview/behaviorQueryBuilder.ts；求值/序列化语义的
// 契约测试在 test/unit/behaviorFilterQuery.test.ts（shared 层）。
import { describe, it, expect } from 'vitest'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { BehaviorQueryBuilder, newQueryBlock } from '../../src/webview/behaviorQueryBuilder'
import type { BehaviorQueryFilter } from '../../src/shared/behaviorFilterQuery'

installLocale('zh-cn', zhCn)

function makeBuilder(): {
  builder: BehaviorQueryBuilder
  changes: BehaviorQueryFilter[]
  clearAllCount: () => number
} {
  const changes: BehaviorQueryFilter[] = []
  let clearAll = 0
  const builder = new BehaviorQueryBuilder({
    onChange: (query) => changes.push(query),
    onClearAll: () => { clearAll += 1 },
  })
  document.body.append(builder.ensureRendered())
  return { builder, changes, clearAllCount: () => clearAll }
}

function blocks(builder: BehaviorQueryBuilder): HTMLElement[] {
  return [...builder.ensureRendered().querySelectorAll<HTMLElement>('.vsidian-bq-block')]
}

function keydown(el: Element, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

/** jsdom 无 DragEvent 构造器：Event + 伪造 dataTransfer（放置语义走
 * dragPathOf 的会话兜底——getData 返回空串） */
function dragEvent(type: string): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      setData: () => {},
      getData: () => '',
      dropEffect: 'move',
      effectAllowed: 'move',
    },
  })
  return event
}

const lastQuery = (changes: BehaviorQueryFilter[]): BehaviorQueryFilter => changes[changes.length - 1]!

describe('#474 构造器：加号下拉与新建（D4/D9）', () => {
  it('加号展开三组菜单（行为/逻辑/状态），选择项新建对应积木入顶层末尾', () => {
    const { builder, changes } = makeBuilder()
    const add = builder.ensureRendered().querySelector<HTMLButtonElement>('.vsidian-behavior-query-add')!
    add.click()
    const menu = builder.ensureRendered().querySelector('.vsidian-bq-menu')!
    const groups = [...menu.querySelectorAll('.vsidian-bq-menu-group')].map((el) => el.textContent)
    expect(groups).toEqual(['行为组件', '逻辑组件', '状态组件'])
    const itemButtons = [...menu.querySelectorAll<HTMLButtonElement>('.vsidian-bq-menu-item')]
    const items = itemButtons.map((el) => el.textContent)
    expect(items).toEqual(['行为显示名', '组件显示名', '行为 ID', '组件 ID', 'AND', 'OR', 'NOT', '启用状态'])
    // 逻辑组选 AND：新建双空槽菱形
    itemButtons[4]!.click()
    expect(lastQuery(changes)).toEqual({
      version: 1,
      blocks: [{ kind: 'logic', op: 'and', children: [null, null] }],
    })
    // 状态组选启用状态：新建默认已启用（D6）
    builder.ensureRendered().querySelector<HTMLButtonElement>('.vsidian-behavior-query-add')!.click()
    const itemButtons2 = [...builder.ensureRendered().querySelectorAll<HTMLButtonElement>('.vsidian-bq-menu-item')]
    itemButtons2[7]!.click()
    expect(lastQuery(changes)).toEqual({
      version: 1,
      blocks: [
        { kind: 'logic', op: 'and', children: [null, null] },
        { kind: 'status', status: 'enabled' },
      ],
    })
  })

  it('菜单选择后关闭；再次点按加号切换关闭', () => {
    const { builder } = makeBuilder()
    const add = builder.ensureRendered().querySelector<HTMLButtonElement>('.vsidian-behavior-query-add')!
    add.click()
    expect(builder.ensureRendered().querySelector('.vsidian-bq-menu')).not.toBeNull()
    add.click()
    expect(builder.ensureRendered().querySelector('.vsidian-bq-menu')).toBeNull()
  })

  it('块数达上限 16 时加号禁用（D9）', () => {
    const { builder } = makeBuilder()
    for (let i = 0; i < 15; i++) {
      builder.addTopLevelBlock(newQueryBlock('status'))
    }
    const add = builder.ensureRendered().querySelector<HTMLButtonElement>('.vsidian-behavior-query-add')!
    expect(add.disabled).toBe(false)
    builder.addTopLevelBlock(newQueryBlock('status'))
    expect(builder.ensureRendered().querySelector<HTMLButtonElement>('.vsidian-behavior-query-add')!.disabled).toBe(true)
    expect(blocks(builder)).toHaveLength(16)
  })

  it('超限提示可达（评审 F1 钉住）：tooltip 挂非禁用包裹且随禁用态切换；aria 全套同步', () => {
    const { builder } = makeBuilder()
    const root = builder.ensureRendered()
    const add = root.querySelector<HTMLButtonElement>('.vsidian-behavior-query-add')!
    const wrap = root.querySelector<HTMLElement>('.vsidian-behavior-query-add-wrap')!
    // 常态：tooltip 与 aria-label 同为「添加」，menu 触发属性在位
    expect(wrap.dataset.tooltip).toBe('添加筛选积木')
    expect(add.getAttribute('aria-label')).toBe('添加筛选积木')
    expect(add.getAttribute('aria-haspopup')).toBe('menu')
    expect(add.getAttribute('aria-expanded')).toBe('false')
    // 打开菜单：aria-expanded 翻转
    add.click()
    expect(add.getAttribute('aria-expanded')).toBe('true')
    add.click()
    expect(add.getAttribute('aria-expanded')).toBe('false')
    // 达上限：tooltip 载体在非禁用包裹上（disabled 按钮不派发鼠标事件），
    // 文案切换为上限说明；aria-label 随禁用态告知原因
    for (let i = 0; i < 16; i++) {
      builder.addTopLevelBlock(newQueryBlock('status'))
    }
    const wrapAtLimit = builder.ensureRendered().querySelector<HTMLElement>('.vsidian-behavior-query-add-wrap')!
    const addAtLimit = builder.ensureRendered().querySelector<HTMLButtonElement>('.vsidian-behavior-query-add')!
    expect(addAtLimit.disabled).toBe(true)
    expect(wrapAtLimit.dataset.tooltip).toBe('积木数量已达上限（16）')
    expect(addAtLimit.getAttribute('aria-label')).toBe('积木数量已达上限（16）')
  })
})

describe('#474 构造器：就地编辑与选中（D8）', () => {
  it('字段文本 input 事件实时上抛（查询树 text 更新，不重建 DOM）', () => {
    const { builder, changes } = makeBuilder()
    builder.addTopLevelBlock({ kind: 'field', field: 'behaviorName', text: '' })
    const input = builder.ensureRendered().querySelector<HTMLInputElement>('.vsidian-bq-field-input')!
    input.value = '括号'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(lastQuery(changes)).toEqual({
      version: 1,
      blocks: [{ kind: 'field', field: 'behaviorName', text: '括号' }],
    })
    // DOM 未重建（同一输入节点保持焦点现场）
    expect(builder.ensureRendered().querySelector('.vsidian-bq-field-input')).toBe(input)
  })

  it('状态下拉切换上抛四态', () => {
    const { builder, changes } = makeBuilder()
    builder.addTopLevelBlock({ kind: 'status', status: 'enabled' })
    const select = builder.ensureRendered().querySelector<HTMLSelectElement>('.vsidian-bq-status-select')!
    select.value = 'errorPaused'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(lastQuery(changes)).toEqual({
      version: 1,
      blocks: [{ kind: 'status', status: 'errorPaused' }],
    })
  })

  it('单击积木选中：自身与嵌套整体发光；单击容器空白取消', () => {
    const { builder } = makeBuilder()
    builder.setQuery({
      version: 1,
      blocks: [{
        kind: 'logic', op: 'and',
        children: [{ kind: 'status', status: 'enabled' }, null],
      }],
    })
    const [logic, status] = blocks(builder)
    logic!.click()
    expect(logic!.classList.contains('vsidian-bq-selected')).toBe(true)
    expect(status!.classList.contains('vsidian-bq-selected')).toBe(true) // 嵌套同发光
    builder.ensureRendered().click()
    expect(logic!.classList.contains('vsidian-bq-selected')).toBe(false)
  })
})

describe('#474 构造器：垃圾桶三用法（D4）', () => {
  it('无选中单击 = 清空整个查询（onClearAll 回调 + 空树上抛）', () => {
    const { builder, changes, clearAllCount } = makeBuilder()
    builder.addTopLevelBlock(newQueryBlock('status'))
    builder.ensureRendered().querySelector<HTMLButtonElement>('.vsidian-behavior-query-trash')!.click()
    expect(clearAllCount()).toBe(1)
    expect(lastQuery(changes)).toEqual({ version: 1, blocks: [] })
  })

  it('有选中单击 = 删除选中积木及其嵌套（保留其他顶层积木）', () => {
    const { builder, changes } = makeBuilder()
    builder.setQuery({
      version: 1,
      blocks: [
        { kind: 'status', status: 'enabled' },
        { kind: 'logic', op: 'not', children: [{ kind: 'status', status: 'disabled' }] },
      ],
    })
    const logic = blocks(builder)[1]!
    logic.click()
    builder.ensureRendered().querySelector<HTMLButtonElement>('.vsidian-behavior-query-trash')!.click()
    expect(lastQuery(changes)).toEqual({
      version: 1,
      blocks: [{ kind: 'status', status: 'enabled' }],
    })
  })

  it('Delete 键 = 删选中（垃圾桶的键盘等价）', () => {
    const { builder, changes } = makeBuilder()
    builder.setQuery({ version: 1, blocks: [{ kind: 'status', status: 'enabled' }] })
    const block = blocks(builder)[0]!
    block.click()
    keydown(block, 'Delete')
    expect(lastQuery(changes)).toEqual({ version: 1, blocks: [] })
  })
})

describe('#474 构造器：键盘嵌套构建（D8：Enter 拾取 → 方向键选缺口 → Enter 放下）', () => {
  function setupCarryScene() {
    const { builder, changes } = makeBuilder()
    builder.setQuery({
      version: 1,
      blocks: [
        { kind: 'status', status: 'enabled' },
        { kind: 'logic', op: 'and', children: [null, null] },
      ],
    })
    const [status, logic] = blocks(builder)
    return { builder, changes, status: status!, logic: logic! }
  }

  it('完整链路：拾取高亮 → 缺口深色高亮 → Enter 放入缺口', () => {
    const { builder, changes, status } = setupCarryScene()
    keydown(status, 'Enter')
    expect(status.classList.contains('vsidian-bq-carrying')).toBe(true)
    // 两个空缺口，初始目标 = 文档序第一个；方向键移动目标到第二缺口
    const slots = [...builder.ensureRendered().querySelectorAll<HTMLElement>('.vsidian-bq-slot--empty')]
    expect(slots[0]!.classList.contains('vsidian-bq-slot--target')).toBe(true)
    keydown(status, 'ArrowRight')
    expect(slots[1]!.classList.contains('vsidian-bq-slot--target')).toBe(true)
    keydown(status, 'Enter')
    expect(lastQuery(changes)).toEqual({
      version: 1,
      blocks: [{
        kind: 'logic', op: 'and',
        children: [null, { kind: 'status', status: 'enabled' }],
      }],
    })
  })

  it('Esc 取消拾取（树不动）', () => {
    const { changes, status } = setupCarryScene()
    keydown(status, 'Enter')
    keydown(status, 'Escape')
    keydown(status, 'Enter') // 已取消：这次 Enter 是新的拾取
    expect(changes).toHaveLength(0)
    expect(status.classList.contains('vsidian-bq-carrying')).toBe(true)
  })

  it('自嵌套防护：不能把逻辑积木放进自己的缺口（放置无效树不变）', () => {
    const { builder, changes } = makeBuilder()
    builder.setQuery({
      version: 1,
      blocks: [{ kind: 'logic', op: 'not', children: [null] }],
    })
    const logic = blocks(builder)[0]!
    keydown(logic, 'Enter') // 拾取——排除自身内部缺口后无可放槽
    keydown(logic, 'Enter') // 无目标：第二次 Enter 等价取消
    expect(changes).toHaveLength(0)
  })
})

describe('#474 构造器：拖拽数据面（放置语义的树变换）', () => {
  it('顶层任意落点（D8）：dropzone 索引修正（先 remove 后 insert）', () => {
    // 直接验证 moveBlock 的树变换正确性经键盘同路径已覆盖；此处钉顶层
    // 重排语义：A 拖到末尾 dropzone（index=2）→ [B, A]
    const { builder, changes } = makeBuilder()
    builder.setQuery({
      version: 1,
      blocks: [
        { kind: 'status', status: 'enabled' },  // A
        { kind: 'status', status: 'disabled' }, // B
      ],
    })
    const [a, b] = blocks(builder)
    // 模拟拖拽到末尾 dropzone：dragstart → dragover → drop
    const zones = [...builder.ensureRendered().querySelectorAll<HTMLElement>('.vsidian-bq-dropzone')]
    const last = zones[zones.length - 1]!
    a!.dispatchEvent(dragEvent('dragstart'))
    last.dispatchEvent(dragEvent('dragover'))
    last.dispatchEvent(dragEvent('drop'))
    expect(lastQuery(changes)).toEqual({
      version: 1,
      blocks: [
        { kind: 'status', status: 'disabled' },
        { kind: 'status', status: 'enabled' },
      ],
    })
    void b
  })

  it('拖到垃圾桶 = 删除该积木（三用法之三）', () => {
    const { builder, changes } = makeBuilder()
    builder.setQuery({ version: 1, blocks: [{ kind: 'status', status: 'enabled' }] })
    const block = blocks(builder)[0]!
    const trash = builder.ensureRendered().querySelector<HTMLButtonElement>('.vsidian-behavior-query-trash')!
    block.dispatchEvent(dragEvent('dragstart'))
    trash.dispatchEvent(dragEvent('drop'))
    expect(lastQuery(changes)).toEqual({ version: 1, blocks: [] })
  })
})
