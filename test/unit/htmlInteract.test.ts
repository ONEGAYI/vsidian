// #571（T06）表单与媒体的原生交互防线契约：
// - 表单提交守卫：编辑器 webview 内任何 submit 事件（Reading 块/嵌入卡/
//   悬停浮层/Live widget 内容——渲染自笔记 HTML）一律 preventDefault——
//   webview 是编辑器本体，表单导航会整页跳走且无表单后端（规格「不承诺
//   表单后端」；临时交互不写回）。
// - 媒体释放：块卸载/视图释放（binding.dispose）后无持续播放——pause +
//   src 剥除 + load() 复位（释放解码器与在途请求；图片槽位 src 清空同款
//   纪律）。模式切换暂停：只 pause 不释放（块仍挂载，回切不重置）。
// 红测纪律：本文件先于实现编写——src/webview/htmlInteract.ts 尚不存在，
// import 即红。
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  installHtmlSubmitGuard,
  releaseHtmlMedia,
  pauseHtmlMedia,
} from '../../src/webview/htmlInteract'

describe('installHtmlSubmitGuard：表单提交守卫（submit 不导航 webview）', () => {
  beforeEach(() => {
    document.body.textContent = ''
  })

  it('阅读容器内表单 submit 被 preventDefault（Reading 块/嵌入卡/浮层同一 document 面）', () => {
    installHtmlSubmitGuard(document)
    const form = document.createElement('form')
    form.action = 'https://example.com/submit'
    form.method = 'get'
    form.innerHTML = '<input type="text" name="q" value="x"><button type="submit">Go</button>'
    document.body.appendChild(form)
    const event = new Event('submit', { bubbles: true, cancelable: true })
    form.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('body 直挂的浮层内容同样拦截（capture 面——不依赖容器层级）', () => {
    installHtmlSubmitGuard(document)
    const host = document.createElement('div')
    host.innerHTML = '<form action="/x"><button formaction="https://a/b">b</button></form>'
    document.body.appendChild(host)
    const event = new Event('submit', { bubbles: true, cancelable: true })
    host.querySelector('form')!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('重复安装幂等（一个守卫，不叠层）', () => {
    installHtmlSubmitGuard(document)
    installHtmlSubmitGuard(document)
    const form = document.createElement('form')
    document.body.appendChild(form)
    const event = new Event('submit', { bubbles: true, cancelable: true })
    form.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('非 submit 事件不受影响（input/click 面零干预）', () => {
    installHtmlSubmitGuard(document)
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    const inputEvent = new Event('input', { bubbles: true, cancelable: true })
    input.dispatchEvent(inputEvent)
    expect(inputEvent.defaultPrevented).toBe(false)
    const clickEvent = new Event('click', { bubbles: true, cancelable: true })
    input.dispatchEvent(clickEvent)
    expect(clickEvent.defaultPrevented).toBe(false)
  })
})

describe('releaseHtmlMedia：块卸载/视图释放（释放后无持续播放）', () => {
  it('video：pause + src 剥除 + load 复位（解码器与在途请求释放）', () => {
    const root = document.createElement('div')
    root.innerHTML = '<video src="https://resolved/clip.mp4" controls></video>'
    const video = root.querySelector('video')!
    const pause = vi.spyOn(video, 'pause')
    const load = vi.spyOn(video, 'load')
    releaseHtmlMedia(root)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)
    expect(video.getAttribute('src')).toBe(null)
  })

  it('source 子元素 src 一并剥除（load() 重选不到候选——真正断流）', () => {
    const root = document.createElement('div')
    root.innerHTML = '<video controls><source src="https://resolved/a.webm" type="video/webm"></video>'
    const video = root.querySelector('video')!
    const source = root.querySelector('source')!
    const pause = vi.spyOn(video, 'pause')
    releaseHtmlMedia(root)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(video.getAttribute('src')).toBe(null)
    expect(source.getAttribute('src')).toBe(null)
    // 非资源属性不动（type 元数据保持）
    expect(source.getAttribute('type')).toBe('video/webm')
  })

  it('audio 同款释放；img/其他元素零干预', () => {
    const root = document.createElement('div')
    root.innerHTML = '<audio src="https://resolved/tone.ogg"></audio><img src="https://resolved/pic.png" alt="图">'
    const audio = root.querySelector('audio')!
    const pause = vi.spyOn(audio, 'pause')
    releaseHtmlMedia(root)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(audio.getAttribute('src')).toBe(null)
    expect(root.querySelector('img')!.getAttribute('src')).toBe('https://resolved/pic.png')
  })

  it('根自身是媒体元素也释放（行内形态内容根即 media）', () => {
    const audio = document.createElement('audio')
    audio.setAttribute('src', 'https://resolved/t.wav')
    const pause = vi.spyOn(audio, 'pause')
    releaseHtmlMedia(audio)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(audio.getAttribute('src')).toBe(null)
  })

  it('装载期剥离记忆一并清理（dataset 不残留）', () => {
    const root = document.createElement('div')
    root.innerHTML = '<video controls></video>'
    const video = root.querySelector('video')!
    // 模拟装载语义的记忆态（相对目标解析前剥离、原文记忆）
    video.removeAttribute('src')
    video.dataset['vsidianMediaSrc'] = 'clip.mp4'
    releaseHtmlMedia(root)
    expect(video.dataset['vsidianMediaSrc']).toBe(undefined)
  })

  it('幂等（重复释放零副作用）', () => {
    const root = document.createElement('div')
    root.innerHTML = '<video src="https://resolved/v.mp4"></video>'
    const video = root.querySelector('video')!
    const pause = vi.spyOn(video, 'pause')
    releaseHtmlMedia(root)
    releaseHtmlMedia(root)
    expect(pause).toHaveBeenCalledTimes(1)
  })
})

describe('pauseHtmlMedia：模式切换暂停（不释放——回切不重置装载）', () => {
  it('pause 但保留 src（块仍挂载，只停止播放）', () => {
    const root = document.createElement('div')
    root.innerHTML = '<video src="https://resolved/v.mp4" controls></video>'
    const video = root.querySelector('video')!
    const pause = vi.spyOn(video, 'pause')
    const load = vi.spyOn(video, 'load')
    pauseHtmlMedia(root)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(load).not.toHaveBeenCalled()
    expect(video.getAttribute('src')).toBe('https://resolved/v.mp4')
  })
})
