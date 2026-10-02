// 阅读视图 frontmatter 卡片折叠契约测试：与代码块同交互——标题栏整条
// 热区 + 右上折叠 chevron；折叠 = 表格行整体隐藏（表壳保留边框圆角），
// 视图态由调用方持有（挂载钩子按当前态重装饰，幂等）。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'

// 文案经 t() 取词：装配生产中文包，断言与字典同源
installLocale('zh-cn', zhCn)
import { decorateReadingFrontmatterCard } from '../../src/webview/frontmatterDecorations'

/** 同构阅读 FM 块（splitReadingBlocks 的形态：块 > fm-table > header + rows） */
function makeFmBlock(): HTMLElement {
  const block = document.createElement('div')
  block.className = 'vsidian-reading-block vsidian-reading-frontmatter'
  block.dataset['vsidianSrcStart'] = '0'
  const table = document.createElement('div')
  table.className = 'vsidian-fm-table'
  const header = document.createElement('div')
  header.className = 'vsidian-fm-header'
  const icon = document.createElement('span')
  icon.className = 'vsidian-fm-header-icon'
  const title = document.createElement('span')
  title.className = 'vsidian-fm-header-title'
  title.textContent = '属性'
  header.append(icon, title)
  table.appendChild(header)
  for (const value of ['hello', '3']) {
    const row = document.createElement('div')
    row.className = 'vsidian-fm-row'
    const key = document.createElement('span')
    key.className = 'vsidian-fm-cell vsidian-fm-key'
    const val = document.createElement('span')
    val.className = 'vsidian-fm-cell vsidian-fm-value'
    val.textContent = value
    row.append(key, val)
    table.appendChild(row)
  }
  block.appendChild(table)
  return block
}

function decorate(block: HTMLElement, over: Partial<Parameters<typeof decorateReadingFrontmatterCard>[1]> = {}) {
  decorateReadingFrontmatterCard(block, { folded: false, onFoldToggle: () => {}, ...over })
}

describe('阅读 frontmatter 卡片折叠', () => {
  it('挂载装饰：标题栏追加折叠 chevron（可收起提示、aria-expanded），行保持在场', () => {
    const block = makeFmBlock()
    decorate(block)
    const fold = block.querySelector<HTMLButtonElement>('.vsidian-fm-fold')
    if (!fold) throw new Error('折叠 chevron 不在场')
    expect(fold.classList.contains('vsidian-fm-fold-collapsed')).toBe(false)
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    expect(fold.getAttribute('data-tooltip')).toContain('折叠')
    expect(block.querySelector('.vsidian-fm-table')?.classList.contains('vsidian-fm-folded'))
      .toBe(false)
    expect(block.querySelectorAll('.vsidian-fm-row')).toHaveLength(2)
  })

  it('收起态：表格挂收起类、chevron 转向修饰与展开文案', () => {
    const block = makeFmBlock()
    decorate(block, { folded: true })
    expect(block.querySelector('.vsidian-fm-table')?.classList.contains('vsidian-fm-folded'))
      .toBe(true)
    const fold = block.querySelector<HTMLButtonElement>('.vsidian-fm-fold')!
    expect(fold.classList.contains('vsidian-fm-fold-collapsed')).toBe(true)
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(fold.getAttribute('data-tooltip')).toContain('展开')
  })

  it('点 chevron 触发切换回调；点标题栏空白热区同样触发；无表格或无标题栏时不触碰', () => {
    const block = makeFmBlock()
    let toggled = 0
    decorate(block, { onFoldToggle: () => { toggled += 1 } })
    block.querySelector<HTMLButtonElement>('.vsidian-fm-fold')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(toggled).toBe(1)
    // 热区：点击标题文字（非按钮）同样触发（一次 click 不双触发——按钮已 stopPropagation）
    block.querySelector<HTMLElement>('.vsidian-fm-header-title')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(toggled).toBe(2)
    // 非 FM 块 / 缺标题栏：安全不作为
    const plain = document.createElement('div')
    plain.className = 'vsidian-reading-block'
    expect(() => decorate(plain)).not.toThrow()
    const noHeader = makeFmBlock()
    noHeader.querySelector('.vsidian-fm-header')!.remove()
    expect(() => decorate(noHeader)).not.toThrow()
  })

  it('幂等重装饰：折叠切换后按新态重建 chevron，不重复堆积按钮', () => {
    const block = makeFmBlock()
    decorate(block)
    decorate(block, { folded: true })
    expect(block.querySelectorAll('.vsidian-fm-fold')).toHaveLength(1)
    decorate(block)
    expect(block.querySelectorAll('.vsidian-fm-fold')).toHaveLength(1)
    expect(block.querySelector('.vsidian-fm-table')?.classList.contains('vsidian-fm-folded'))
      .toBe(false)
  })
})
