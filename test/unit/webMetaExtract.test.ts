// #342（P3-10）HTML 元信息提取契约：非执行解析（htmlparser2）只收集
// <title> 文本与 meta（description/og）——script/style 内容不进入提取、
// entity 解码、空白清洗与长度截断。恶意样例：onload 内联脚本、meta
// refresh、img 子资源标记均只是文本，不执行、不触发任何请求（提取器
// 纯函数零网络，服务层的「单请求」计数在 webLinkMetaService 契约另钉）。
import { describe, expect, it } from 'vitest'
import { MAX_WEB_DESCRIPTION_CHARS, MAX_WEB_TITLE_CHARS, parseWebMetaFromHtml } from '../../src/host/webMetaExtract'

describe('parseWebMetaFromHtml', () => {
  it('提取 title 与 meta description', () => {
    const meta = parseWebMetaFromHtml(`<!doctype html>
<html><head><title>示例页面</title>
<meta name="description" content="这是页面摘要">
</head><body><p>正文不进入摘要</p></body></html>`)
    expect(meta).toEqual({ title: '示例页面', description: '这是页面摘要' })
  })

  it('og:title / og:description 优先于 title / description', () => {
    const meta = parseWebMetaFromHtml(`<html><head>
<title>兜底标题</title>
<meta property="og:title" content="社交标题">
<meta name="description" content="兜底摘要">
<meta property="og:description" content="社交摘要">
</head></html>`)
    expect(meta).toEqual({ title: '社交标题', description: '社交摘要' })
  })

  it('og 缺席时回落 title / description', () => {
    const meta = parseWebMetaFromHtml(`<html><head>
<title>兜底标题</title>
<meta property="og:title" content="">
<meta name="description" content="兜底摘要">
</head></html>`)
    expect(meta).toEqual({ title: '兜底标题', description: '兜底摘要' })
  })

  it('meta 标签大小写与属性顺序不敏感', () => {
    const meta = parseWebMetaFromHtml(`<html><head>
<TITLE>大写标题</TITLE>
<META CONTENT="大写摘要" NAME="Description">
</head></html>`)
    expect(meta).toEqual({ title: '大写标题', description: '大写摘要' })
  })

  it('entity 解码：标题与摘要中的 &amp; &lt; 等', () => {
    const meta = parseWebMetaFromHtml(`<html><head><title>A &amp; B &lt;tag&gt;</title>
<meta name="description" content="x &gt; y &quot;quoted&quot; &#39;ap&#39;">
</head></html>`)
    expect(meta.title).toBe('A & B <tag>')
    expect(meta.description).toBe('x > y "quoted" \'ap\'')
  })

  it('空白清洗：title 内部换行/多空格折叠，首尾剥除', () => {
    const meta = parseWebMetaFromHtml(`<html><head><title>
   多行
   标题  文本
</title></head></html>`)
    expect(meta.title).toBe('多行 标题 文本')
  })

  it('中文 entity 数字引用解码（&#20013;）', () => {
    const meta = parseWebMetaFromHtml(`<html><head><title>&#20013;&#25991;</title></head></html>`)
    expect(meta.title).toBe('中文')
  })

  it('恶意样例：script/onload/meta refresh 不进入提取结果', () => {
    const meta = parseWebMetaFromHtml(`<html><head>
<title>真实标题</title>
<script>alert('title 之后的脚本')</script>
<meta http-equiv="refresh" content="0;url=http://evil.example/">
</head><body onload="steal()">
<img src="https://tracker.example/pixel.png">
<iframe src="https://evil.example/frame"></iframe>
</body></html>`)
    expect(meta.title).toBe('真实标题')
    expect(meta.description).toBe('')
  })

  it('script 内的伪 title 文本不被误提取', () => {
    const meta = parseWebMetaFromHtml(`<html><head>
<script>var x = '<title>fake</title>'</script>
<title>real</title>
</head></html>`)
    expect(meta.title).toBe('real')
  })

  it('style/注释内的伪 meta 不污染提取', () => {
    const meta = parseWebMetaFromHtml(`<html><head>
<!-- <meta name="description" content="commented"> -->
<style>/* <meta name="description" content="styled"> */</style>
<meta name="description" content="real">
</head></html>`)
    expect(meta.description).toBe('real')
  })

  it('body 内的 title 标签不覆盖 head 提取（首个 title 生效）', () => {
    const meta = parseWebMetaFromHtml(`<html><head><title>head</title></head>
<body><title>body</title></body></html>`)
    expect(meta.title).toBe('head')
  })

  it('缺失 title/description 返回空串（非 null）', () => {
    const meta = parseWebMetaFromHtml(`<html><head></head><body>正文</body></html>`)
    expect(meta).toEqual({ title: '', description: '' })
  })

  it('空/畸形输入零异常，返回空串', () => {
    expect(parseWebMetaFromHtml('')).toEqual({ title: '', description: '' })
    expect(parseWebMetaFromHtml('<<<html broken')).toEqual({ title: '', description: '' })
  })

  it(`超长 title/description 截断到 ${MAX_WEB_TITLE_CHARS}/${MAX_WEB_DESCRIPTION_CHARS} 字符`, () => {
    const longTitle = 'T'.repeat(MAX_WEB_TITLE_CHARS + 500)
    const longDesc = 'D'.repeat(MAX_WEB_DESCRIPTION_CHARS + 500)
    const meta = parseWebMetaFromHtml(
      `<html><head><title>${longTitle}</title><meta name="description" content="${longDesc}"></head></html>`,
    )
    expect(meta.title.length).toBe(MAX_WEB_TITLE_CHARS)
    expect(meta.description.length).toBe(MAX_WEB_DESCRIPTION_CHARS)
  })

  it('截断常量契约：title 200 / description 500（缓存字节与显示友好折衷）', () => {
    expect(MAX_WEB_TITLE_CHARS).toBe(200)
    expect(MAX_WEB_DESCRIPTION_CHARS).toBe(500)
  })

  it('大文档（2 MiB 填充）提取不抛异常且结果正确', () => {
    const filler = '<div>' + 'x'.repeat(1024) + '</div>'.repeat(2048)
    const meta = parseWebMetaFromHtml(`<html><head><title>big</title></head><body>${filler}</body></html>`)
    expect(meta.title).toBe('big')
  })
})
