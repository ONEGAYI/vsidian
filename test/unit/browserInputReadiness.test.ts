import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

it('热切换的宿主回执驱动覆盖 IME 定稿后异步出站的请求（#552 条目26）', () => {
  const source = ts.createSourceFile('addonHotSwitch.mjs', readFileSync('test/browser/addonHotSwitch.mjs', 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const callbacks: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'waitForFunction' &&
      node.arguments[0]?.getText(source).includes('pendingInput()')) callbacks.push(node.arguments[0])
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(callbacks).toHaveLength(1)
  const sample = new Function('window', `return (${callbacks[0]!.getText(source)})();`)
  let requestArrived = false
  let acknowledged = false
  const host = {
    ackPendingEdits() { if (requestArrived) acknowledged = true },
    pendingInput() { return !acknowledged },
  }
  expect(sample(host)).toBe(false)
  // 组合结束的 flush 宏任务在首次采样后才把 edit.request 发往宿主。
  requestArrived = true
  expect(sample(host)).toBe(true)
  expect(acknowledged).toBe(true)
})
