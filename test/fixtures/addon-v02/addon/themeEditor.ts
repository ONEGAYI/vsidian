// #546 T07 主题夹具组件编辑器页源码：消费页面 SDK 的 renderers 面登记
// 主题关联渲染提供者 + themeEnvironment 面订阅明暗（组件图形重画的消费
// 样例——bridge#3 可参照的接口用法）。经 V02 构建桥打成独立 IIFE。
//
// 贡献面（对齐宿主侧 extension.js 的 themes.register 声明）：
// - aqua-renderer：主题关联提供者（languages: ['mermaid']，live+reading）；
//   mount 落 theme-box（provider 标记 + 明暗标记 + 计算色锚——绘制层断言）；
// - themeEnvironment 订阅：变化回调中改写已挂载容器的明暗标记（组件在
//   回调中更新已挂载图形——H-U07 的消费样例），并把快照计数上报通道
//   （宿主侧集成断言消费）。
//
// 共享会话防毒化：与 T09 同款通道放行门控（默认惰性，宿主命令放行后才
// 注册候选）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'vsidian-test-fixture.addon-theme'

defineAddonPage(ADDON_ID, async (sdk: VsidianAddonPageSdk) => {
  const renderers = sdk.renderers
  const themeEnvironment = sdk.themeEnvironment
  if (!renderers) {
    throw new Error('编辑器页 SDK 缺少 renderers 面')
  }
  if (!themeEnvironment) {
    throw new Error('编辑器页 SDK 缺少 themeEnvironment 面')
  }

  // 共享会话防毒化：默认惰性，宿主放行后才注册（对齐 T09 先例）
  const permission = await sdk.channel.request('theme.providersAllowed', null)
  const allowed = permission.ok === true &&
    (permission.result as { allowed?: unknown } | null)?.allowed === true
  if (!allowed) {
    return
  }

  /** 已挂载容器集（明暗回调遍历改写——组件自己的图形更新责任） */
  const mounted = new Set<HTMLElement>()
  const paintBox = (box: HTMLElement) => {
    const env = themeEnvironment.get()
    box.setAttribute('data-theme-dark', env.dark ? '1' : '0')
    box.setAttribute('data-theme-hc', env.highContrast ? '1' : '0')
    box.style.backgroundColor = env.dark ? 'rgb(0, 70, 64)' : 'rgb(0, 138, 123)'
  }

  const mountBox = (container: HTMLElement, code: string, ctx: { language: string; mode: string }) => {
    container.textContent = ''
    const box = document.createElement('div')
    box.className = 'theme-box'
    box.setAttribute('data-theme-renderer', 'aqua-renderer')
    box.setAttribute('data-theme-language', ctx.language)
    box.setAttribute('data-theme-mode', ctx.mode)
    paintBox(box)
    box.textContent = `aqua:${ctx.language}:${code.slice(0, 12)}`
    container.appendChild(box)
    mounted.add(box)
    box.addEventListener('theme-box-detach', () => mounted.delete(box), { once: true })
  }

  renderers.register({
    rendererId: 'aqua-renderer',
    label: 'T07 Aqua Theme',
    languages: ['mermaid'],
    modes: ['live', 'reading'],
    exportFormats: ['svg'],
    mount: mountBox,
    refresh: (container, code, ctx) => mountBox(container, code, ctx),
    release: (container) => {
      for (const box of container.querySelectorAll('.theme-box')) {
        box.dispatchEvent(new CustomEvent('theme-box-detach'))
      }
      container.setAttribute('data-theme-released', '1')
    },
    exportSvg: async (code) =>
      `<svg xmlns="http://www.w3.org/2000/svg" data-theme-export="aqua" width="80" height="20"><rect width="80" height="20" fill="#00897b"/><text x="4" y="14" fill="#fff">${code.slice(0, 8)}</text></svg>`,
  })

  // 明暗订阅：改写已挂载图形的明暗标记（绘制层断言锚）+ 计数进全局观测
  const g = globalThis as { __t07ThemeEnvEvents?: Array<{ dark: boolean; highContrast: boolean }> }
  g.__t07ThemeEnvEvents = [themeEnvironment.get()]
  void sdk.channel.request('theme.environment', { env: themeEnvironment.get(), atRead: themeEnvironment.get() })
  themeEnvironment.onChange((env) => {
    g.__t07ThemeEnvEvents!.push(env)
    void sdk.channel.request('theme.environment', { env, atRead: themeEnvironment.get() })
    for (const box of [...mounted]) {
      if (box.isConnected) {
        paintBox(box)
      }
    }
  })
})
