// #351 T02 测试组件设置页源码（模拟组件作者用公开 SDK 在自身设置页
// 挂载内容并经 JSON 通道与宿主通信）。挂载行为：
// - mountRoot 渲染标题与按钮（按钮触发通道请求——交互路径留存给人工
//   验证；集成断言走装载即请求，不依赖跨进程点击）；
// - 装载即发 t02.settingsEcho（setup scope——停用后仍服务的通道），
//   回执结局经 t02.report 上报；
// - 资源子目录经 sdk.resourceUri 引用 logo.png（授权资源装载证据）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'

const ADDON_ID = 'vsidian-test-fixture.addon-t02'

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const root = sdk.mountRoot()
  if (!root) {
    throw new Error('设置页 SDK 未提供挂载根')
  }
  root.className = 't02-settings-root'
  const title = document.createElement('h3')
  title.className = 't02-title'
  title.textContent = 'T02 test addon settings'
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
  ping.textContent = 'Echo'
  ping.addEventListener('click', () => {
    void sdk.channel.request('t02.settingsEcho', { phase: 'click' })
  })
  root.append(ping)

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
