// #351 T02 测试组件设置页源码（模拟组件作者用公开 SDK 在自身设置页
// 挂载内容并经 JSON 通道与宿主通信）。挂载行为：
// - mountRoot 渲染标题与按钮（按钮触发通道请求——交互路径留存给人工
//   验证；集成断言走装载即请求，不依赖跨进程点击）；
// - 装载即发 t02.settingsEcho（setup scope——停用后仍服务的通道），
//   回执结局经 t02.report 上报；
// - 资源子目录经 sdk.resourceUri 引用 logo.png（授权资源装载证据）。
// - #582 用公开 sdk.locale 渲染组件自有字典；下一帧经既有 t02.report
//   通道回报实际标题/计算色/可见性，真宿主断言不新增生产 DOM 探针。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'

const ADDON_ID = 'vsidian-test-fixture.addon-t02'
const COPY = {
  en: { title: 'T02 test addon settings', echo: 'Echo' },
  'zh-cn': { title: 'T02 测试组件设置', echo: '回声' },
}

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const root = sdk.mountRoot()
  if (!root) {
    throw new Error('设置页 SDK 未提供挂载根')
  }
  root.className = 't02-settings-root'
  const locale = sdk.locale
  if (!locale) {
    throw new Error('设置页 SDK 未提供 locale 面')
  }
  const title = document.createElement('h3')
  title.className = 't02-title'
  root.append(title)

  // 授权资源引用（resourceUri 解析锚 = 登记的首个资源子目录）
  const logoSrc = sdk.resourceUri('logo.png')
  if (logoSrc) {
    // 先挂监听再设 src（V02 实证竞态：src 先设可能错过 load 事件）
    const logo = document.createElement('img')
    logo.alt = 'logo'
    const done = new Promise<boolean>((resolve) => {
      logo.addEventListener('load', () => resolve(true))
      logo.addEventListener('error', () => resolve(false))
    })
    logo.src = logoSrc
    root.append(logo)
    void done.then((loaded) =>
      sdk.channel.request('t02.report', { topic: 'settingsLogo', ok: true, logoLoaded: loaded }))
  }

  const ping = document.createElement('button')
  ping.type = 'button'
  ping.addEventListener('click', () => {
    void sdk.channel.request('t02.settingsEcho', { phase: 'click' })
  })
  root.append(ping)

  // 每次工厂调用独有身份，用于区分热更与意外重新装载（代次号本身不够）。
  const instanceId = `${sdk.addon.generation}:${Date.now()}:${Math.random()}`
  let disposed = false
  let changes = 0
  sdk.onDispose(() => { disposed = true })
  const renderLocale = (lang: string, phase: 'initial' | 'change'): void => {
    const copy = lang === 'zh-cn' ? COPY['zh-cn'] : COPY.en
    title.textContent = copy.title
    ping.textContent = copy.echo
    const changeCount = changes
    // 工厂可能先于详情挂载运行；仅在可见后上报，60 帧仍未挂载则回报
    // visible=false 供失败诊断，不把 jsdom/脱离文档的 DOM 当作绘制证据。
    const reportPaint = (framesLeft: number): void => {
      if (disposed || locale.get() !== lang) return
      const style = getComputedStyle(title)
      const rect = title.getBoundingClientRect()
      const visible = title.isConnected && style.display !== 'none' && style.visibility === 'visible' &&
        rect.width > 0 && rect.height > 0
      if (!visible && framesLeft > 0) {
        requestAnimationFrame(() => reportPaint(framesLeft - 1))
        return
      }
      void sdk.channel.request('t02.report', {
        topic: 'settingsLocale', locale: lang, phase, changeCount, instanceId,
        generation: sdk.addon.generation, titleText: title.textContent,
        titleColor: style.color, visible,
      })
    }
    requestAnimationFrame(() => reportPaint(60))
  }
  renderLocale(locale.get(), 'initial')
  locale.onChange((lang) => { changes += 1; renderLocale(lang, 'change') })

  // 装载即发一次 setup scope 通道请求（回执结局经 t02.report 上报——
  // 宿主侧可数，断言「停用后设置通道仍服务」用同一 topic）
  void sdk.channel
    .request('t02.settingsEcho', { phase: 'mounted', generation: sdk.addon.generation })
    .then((outcome) =>
      sdk.channel.request('t02.report', {
        topic: 'settingsEcho',
        ok: outcome.ok,
        echoed: outcome.ok ? outcome.result : null,
      }))
    .catch(() => {
      // 释放等异常不上报
    })
})
