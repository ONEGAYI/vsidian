// #342（P3-10）外链卡片元信息提取（htmlparser2@12.0.0，精确版本锁定）：
// 从 HTML 字节流提取 <title> 与 meta（description / og:title / og:
// description）——纯文本级 SAX 解析，**非执行**：不运行 script、不发任何
// 网络请求（img/iframe 子资源标记只是文本）、不产生 DOM 侧效应。
//
// 选型依据（相对 node-html-parser / cheerio）：
// - htmlparser2 为流式 SAX 解析器，依赖链只有 domhandler/domutils/
//   domelementtype/entities 四个同族小包；node-html-parser 9.x 额外引入
//   css-select 全家（boolbase/css-what/nth-check），cheerio 更重——元信息
//   提取只需两个标签族，DOM 树与选择器引擎都是多余体积（VSIX 红线考量）；
// - script/style 内容进入 CDATA text mode，不解析成标签——「script 内伪
//   title」天然不污染提取；
// - decodeEntities 内建（契约钉住 entity 解码行为）。
import { Parser } from 'htmlparser2'

/** 标题/摘要长度上限（字符）：显示友好 + 缓存字节可控的折衷 */
export const MAX_WEB_TITLE_CHARS = 200
export const MAX_WEB_DESCRIPTION_CHARS = 500

/** 提取结果：title/description 缺席为空串（消费端以域名兜底显示） */
export interface WebMetaExtract {
  title: string
  description: string
}

/** 非执行提取 <title> + meta 档案：og:title/og:description 优先，title/
 *  name=description 回落；空白折叠、entity 解码、长度截断 */
export function parseWebMetaFromHtml(html: string): WebMetaExtract {
  let inTitle = false
  let titleClosed = false
  let rawTitle = ''
  let tagTitle = ''
  let ogTitle = ''
  let nameDescription = ''
  let ogDescription = ''

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === 'title' && !titleClosed) {
          inTitle = true
        } else if (name === 'meta') {
          const key = (attrs['name'] ?? attrs['property'] ?? '').toLowerCase()
          const content = attrs['content'] ?? ''
          if (content === '') {
            return
          }
          if (key === 'og:title' && ogTitle === '') {
            ogTitle = content
          } else if (key === 'og:description' && ogDescription === '') {
            ogDescription = content
          } else if (key === 'description' && nameDescription === '') {
            nameDescription = content
          }
          // http-equiv（refresh 等）与其他 meta 一律不消费：meta URL 不执行
        }
      },
      ontext(text) {
        if (inTitle) {
          rawTitle += text
        }
      },
      onclosetag(name) {
        if (name === 'title' && inTitle) {
          inTitle = false
          titleClosed = true
          tagTitle = rawTitle
        }
      },
    },
    { decodeEntities: true },
  )
  parser.write(html)
  parser.end()

  const title = clean(ogTitle !== '' ? ogTitle : tagTitle, MAX_WEB_TITLE_CHARS)
  const description = clean(ogDescription !== '' ? ogDescription : nameDescription, MAX_WEB_DESCRIPTION_CHARS)
  return { title, description }
}

/** 空白折叠 + 首尾剥除 + 长度截断（按 UTF-16 字符） */
function clean(value: string, maxChars: number): string {
  const folded = value.replace(/\s+/g, ' ').trim()
  return folded.length > maxChars ? folded.slice(0, maxChars) : folded
}
