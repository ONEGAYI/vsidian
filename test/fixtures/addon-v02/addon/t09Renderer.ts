// #358 T09 测试组件编辑器页源码：消费页面 SDK 的 renderers 面注册代码块
// 渲染提供者（模拟组件作者公开路径）。经 V02 构建桥打成独立 IIFE。
//
// 登记的提供者（覆盖 T09 票面验收路径）：
// - mermaid-alt：接管内置 mermaid（live+reading 双模式、svg/png 导出）；
//   mount 同步落 t09-box 标记内容并调度一次延迟写入（迟到结果场景——
//   热切换后旧容器脱离文档，延迟写不得回潮进正文）；
// - draw-alpha / draw-beta：同批两个候选竞争新语言 t09draw（稳定 ID 升序
//   末位生效的确定性断言锚——默认 draw-beta 生效，用户首选可改 alpha）；
// - aa-reading-only：仅 reading 模式的 mermaid 候选（模式过滤断言锚——
//   live 回内置，不调用未支持模式的入口；ID 前缀 aa 保证同批默认序上
//   排在 mermaid-alt 之前，不干扰默认接管断言）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'vsidian-test-fixture.addon-t09'

defineAddonPage(ADDON_ID, async (sdk: VsidianAddonPageSdk) => {
  const renderers = sdk.renderers
  if (!renderers) {
    throw new Error('编辑器页 SDK 缺少 renderers 面')
  }

  // 集成/浏览器宿主是**共享会话**：本夹具默认不注册任何候选（生效表零
  // 变化——否则全suite的 mermaid/阅读解析用例被本组件毒化）。宿主侧
  // armProviders 命令显式放行后才注册（T09 用例按需开启，用毕 disarm）；
  // 未放行时本页装载保持惰性（等价 T02/T06 夹具的加性贡献）。
  const permission = await sdk.channel.request('t09.providersAllowed', null)
  const allowed = permission.ok === true &&
    typeof (permission.result as { allowed?: unknown } | null)?.allowed === 'boolean' &&
    (permission.result as { allowed: boolean }).allowed === true
  if (!allowed) {
    return
  }

  /** 容器内挂载：清空后落 t09-box（携带提供者 ID 与源码——绘制层断言锚） */
  const mountBox = (rendererId: string, late: boolean) => (container: HTMLElement, code: string, ctx: { language: string; mode: string }) => {
    container.textContent = ''
    const box = document.createElement('div')
    box.className = 't09-box'
    box.setAttribute('data-t09-renderer', rendererId)
    box.setAttribute('data-t09-language', ctx.language)
    box.setAttribute('data-t09-mode', ctx.mode)
    box.textContent = `${rendererId}:${ctx.language}:${code}`
    container.appendChild(box)
    if (late) {
      // 迟到结果：热切换换新容器后，此写入落在脱离文档的旧容器上
      window.setTimeout(() => {
        const mark = document.createElement('span')
        mark.setAttribute('data-t09-late', '1')
        box.appendChild(mark)
      }, 400)
    }
  }

  renderers.register({
    rendererId: 'mermaid-alt',
    label: 'T09 Mermaid Alt',
    languages: ['mermaid'],
    modes: ['live', 'reading'],
    exportFormats: ['svg', 'png'],
    mount: mountBox('mermaid-alt', true),
    release: (container) => {
      container.setAttribute('data-t09-released', '1')
    },
    exportSvg: async (code) =>
      `<svg xmlns="http://www.w3.org/2000/svg" data-t09-export="mermaid-alt" width="80" height="20"><rect width="80" height="20" fill="#0960f6"/><text x="4" y="14" fill="#fff">${code.slice(0, 8)}</text></svg>`,
  })

  renderers.register({
    rendererId: 'draw-alpha',
    label: 'T09 Draw Alpha',
    languages: ['t09draw'],
    modes: ['live', 'reading'],
    exportFormats: ['svg'],
    mount: mountBox('draw-alpha', false),
    exportSvg: async () => '<svg xmlns="http://www.w3.org/2000/svg" data-t09-export="draw-alpha"></svg>',
  })

  renderers.register({
    rendererId: 'draw-beta',
    label: 'T09 Draw Beta',
    languages: ['t09draw'],
    modes: ['live', 'reading'],
    exportFormats: ['svg'],
    mount: mountBox('draw-beta', false),
    exportSvg: async () => '<svg xmlns="http://www.w3.org/2000/svg" data-t09-export="draw-beta"></svg>',
  })

  renderers.register({
    rendererId: 'aa-reading-only',
    label: 'T09 Reading Only',
    languages: ['mermaid'],
    modes: ['reading'],
    exportFormats: [],
    mount: mountBox('aa-reading-only', false),
  })
  // 故障注入（t09.echo 抛错）由宿主侧 extension.js 的 enable 通道注册——
  // 页面 SDK 只有 channel.request（发起方），handler 归宿主定义
})
