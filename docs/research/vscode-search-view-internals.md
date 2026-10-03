# #318 原型验证：VSCode 搜索视图内部命令与状态可读性（源码事实表）

> 核查对象：microsoft/vscode，tag `1.82.3` 为主，branch `main` 对照。
> 所有行号来自实际读取的 GitHub 源码原文（raw 读取，核查时点 2026-10-03）。
> 用途：ONEGAYI/vsidian #318 的原型验证依据与上游跟踪底稿——官方 API
> （microsoft/vscode#289785）落地或未来版本抽查 copyMatch 行为漂移时，
> 按本文行号口径复核即可。
> 仓库内源码路径均为 `src/vs/workbench/contrib/search/...`（下文简写省略此前缀）。

---

## 1. copyMatch 输出格式（1.82.3）

**结论**：`search.action.copyMatch` 按「选中节点类型」分派三种输出；匹配级（Match）输出只有**起始行列 + 匹配行文本**，不含文件路径、不含结束位置；文件级（FileMatch）输出「路径 + 该文件全部匹配的起始行列 + 文本」；文件夹级递归拼接。多条选中时只取 `getSelection()[0]` 单条。输出经 `clipboardService.writeText` 写剪贴板，命令返回值不含文本。

证据（`browser/searchActionsCopy.ts` @1.82.3）：

- 注册 L19-48：`id: Constants.CopyMatchCommandId`，即 `search.action.copyMatch`（id 字符串见 `common/constants.ts` L16）；无 `precondition`、`f1` 未开（仅菜单 + 树内 Ctrl+C 键绑定，L30-34）。**无 precondition 意味着 `executeCommand` 不受键绑定 when 子句限制，扩展侧可随时执行。**
- 入参回退 L132-140：`executeCommand('search.action.copyMatch')` 不带参时，`match` 为 `undefined` → 走 `getSelectedRow()`：

  ```ts
  // L132-140
  async function copyMatchCommand(accessor: ServicesAccessor, match: RenderableMatch | undefined) {
      if (!match) {
          const selection = getSelectedRow(accessor);
          if (!selection) { return; }
          match = selection;
      }
  ```

  ```ts
  // L250-254
  function getSelectedRow(accessor: ServicesAccessor): RenderableMatch | undefined | null {
      const viewsService = accessor.get(IViewsService);
      const searchView = getSearchView(viewsService);
      return searchView?.getControl().getSelection()[0];
  }
  ```

  即读**搜索树当前 selection 的第一条**——这正是「点击后读选中条目」的通道。
- Match 级输出（`matchToString`，L173-198）：首行前缀 `${startLineNumber},${startColumn}`，多行匹配的后续行前缀只有行号（`startLineNumber + i`），前缀对齐填充后拼接为 `prefix: line`，行间 `\n` 连接。**只有起点，无终点；无路径。**
- FileMatch 级输出（`fileMatchToString`，L208-217）：`labelService.getUriLabel(resource, { noPrefix: true })` + 行分隔符 + 按 `searchMatchComparer` 排序后的全部匹配文本（各缩进 2 格）。
- FolderMatch 级（L219-235）：递归 `folderMatchToString`，条目间双换行。
- 多选只取第一条：L253 `getSelection()[0]`；树本身 `multipleSelectionSupport: true`（searchView.ts L858），但复制语义忽略多选。

**对原型的影响**：点击匹配级条目后执行 copyMatch，只能恢复「起始 line,col + 行文本」；路径与终点须另想办法（见速判）。

## 2. copyPath 输出（1.82.3）

**结论**：`search.action.copyPath` 写入 `getUriLabel(resource, { noPrefix: true })`（无 scheme/工作区名前缀的完整路径标签，Windows 下形如 `d:\path\to\file.md`），**不带行列**；且当选中条目是 Match 级（不是文件/资源文件夹节点）时**静默 return，不写剪贴板**。

证据（`browser/searchActionsCopy.ts` @1.82.3）：

```ts
// L115-130
async function copyPathCommand(accessor: ServicesAccessor, fileMatch: FileMatch | FolderMatchWithResource | undefined) {
    if (!fileMatch) {
        const selection = getSelectedRow(accessor);
        if (!(selection instanceof FileMatch || selection instanceof FolderMatchWithResource)) {
            return;   // ← 选中是 Match 级时，什么都不写
        }
        fileMatch = selection;
    }
    ...
    const text = labelService.getUriLabel(fileMatch.resource, { noPrefix: true });  // L128
    await clipboardService.writeText(text);
}
```

注册 L50-82，id = `search.action.copyPath`（constants.ts L15）。

**对原型的影响**：用户点开搜索树点的是**单条匹配**（Match 级）时，copyPath 无输出——不能作为 Match 级选中的路径来源；仅在选中停留在文件节点/资源文件夹节点时给出路径。

## 3. copyAllResults 输出（1.82.3）

**结论**：`search.action.copyAll` 把**整个搜索结果树**（所有文件夹 → 所有文件 → 所有匹配）序列化为与 copyMatch 文件级相同的「路径 + 行列 + 文本」文本写剪贴板；格式上可当「读全部结果」通道，但走剪贴板、全量无过滤。

证据（`browser/searchActionsCopy.ts` @1.82.3）：

```ts
// L159-171
async function copyAllCommand(accessor: ServicesAccessor) {
    ...
    const searchView = getSearchView(viewsService);
    if (searchView) {
        const root = searchView.searchResult;
        const text = allFolderMatchesToString(root.folderMatches(), labelService);  // L168
        await clipboardService.writeText(text);
    }
}
```

`allFolderMatchesToString`（L237-248）排序文件夹、跳过 count 为 0 的文件夹，双换行连接。注册 L84-108，id = `search.action.copyAll`（constants.ts L17）。

**对原型的影响**：可作「全量结果快照」兜底（含路径与各匹配起点），但结果集大时是巨量文本且污染剪贴板，只宜诊断/对照用。

## 4. getSearchResults 存在性复核

**结论**：上游 main 存在 `search.action.getSearchResults`（返回值通道，不碰剪贴板，`f1: false`）；**1.82.3 确凿不存在**（同文件全文与命令常量表均无）。票面描述属实，但位置在 main 版 L102-129。

证据（main，`browser/searchActionsCopy.ts`）：

```ts
// main L102-129（节选）
registerAction2(class GetSearchResultsAction extends Action2 {
    constructor() {
        super({
            id: Constants.SearchCommandIds.GetSearchResultsActionId,   // L105
            title: nls.localize2('getSearchResultsLabel', "Get Search Results"),
            category,
            f1: false
        });
    }
    override async run(accessor: ServicesAccessor): Promise<any> {
        ...
            const textSearchResult = allFolderMatchesToString(root.folderMatches(), labelService);
            const aiSearchResult = allFolderMatchesToString(root.folderMatches(true), labelService);
            const text = `${textSearchResult}${lineDelimiter}${lineDelimiter}${aiSearchResult}`;
            return text;                                              // L124：返回文本而非写剪贴板
        ...
```

id 字符串：main `common/constants.ts` L43 `GetSearchResultsActionId = 'search.action.getSearchResults'`。

1.82.3 侧复核：

- `browser/searchActionsCopy.ts` @1.82.3 全文 256 行，仅注册 CopyMatch / CopyPath / CopyAll 三个 action（L19、L50、L84），**无 GetSearchResults**。
- `common/constants.ts` @1.82.3 全文 75 行，命令 id 常量表 L8-50 中**无** GetSearchResults 相关条目。

两版注册对比：main = 4 个 action（copy 三件套 + getSearchResults，且 copy 三件套的模型层改为 `searchTreeModel/searchTreeCommon` 的类型守卫函数）；1.82.3 = 3 个（copy 三件套，基于 `searchModel.ts` 的 class instanceof）。

**对原型的影响**：在 1.82.3 下限上，「不碰剪贴板的返回值通道」不存在，只能用 copy 三件套（剪贴板）或在扩展侧自建定位推断；getSearchResults 可作为「随 VSCode 升级后的优化路径」记入设计备注。

## 5. 搜索树点击后的选中态（1.82.3）

**结论**：单击匹配条目 = **选中 + 打开**一体（列表默认 singleClick 打开）；选中态在「打开文件」过程中保留，在**每次发起新搜索时被清空**。

证据：

- 单击即打开：`browser/searchView.ts` L846-864 构造树时未覆写 `openOnSingleClick`；平台默认 `workbench.list.openMode` 为 `singleClick`（`src/vs/platform/list/browser/listService.ts` L1382-1387，enum `['singleClick','doubleClick']` default `'singleClick'`），listService.ts L705-706 将其转成 `openOnSingleClick = true`。
- 打开路径：searchView.ts L871-880 监听 `tree.onDidOpen`（150ms debounce）——

  ```ts
  // L871-880（节选）
  this._register(Event.debounce(this.tree.onDidOpen, ...)(options => {
      if (options.element instanceof Match) {
          const selectedMatch: Match = options.element;
          this.currentSelectedFileMatch?.setSelectedMatch(null);
          this.currentSelectedFileMatch = selectedMatch.parent();
          this.currentSelectedFileMatch.setSelectedMatch(selectedMatch);
          this.onFocus(selectedMatch, options.editorOptions.preserveFocus, options.sideBySide, ...);
      }
  }));
  ```

  → `onFocus`（L1877-1884）→ `open`（L1886-1947）：

  ```ts
  // L1886-1903（节选）
  async open(element: FileMatchOrMatch, preserveFocus?, sideBySide?, pinned?, resourceInput?): Promise<void> {
      const selection = getEditorSelectionFromMatch(element, this.viewModel);   // L1887
      const options = { preserveFocus, pinned, selection, revealIfVisible: true };  // L1892-1897
      editor = await this.editorService.openEditor({ resource, options }, ...ACTIVE_GROUP);  // L1900-1903
  ```

  **定位完全依赖 openEditor 的 `options.selection`**——这正是 custom editor 丢 selection 的机制层出处：L1905-1913 打开后的高亮兜底也仅对 `isCodeEditor(editorControl)` 生效，custom editor 走 `else` 分支移除高亮。
- selection 的取值语义（`getEditorSelectionFromMatch`，L2155-2177）：Match 级 → `match.range()` 完整起止；**FileMatch 级（count>0）→ 该文件最后一个匹配的 range**（L2160-2161）；无匹配/文件夹级 → `undefined`（仅打开文件）。
- 选中保留 vs 清空：`open()` 全程不动树 selection；清空点在 `doSearch`（发起新查询）——

  ```ts
  // searchView.ts L1744-1745（doSearch 方法尾部，L1604 起）
  this.tree.setSelection([]);
  this.tree.setFocus([]);
  const result = this.viewModel.search(query);
  ```

  即 searchOnType 继续输入、用户改查询重搜时，上一轮选中立即失效。另 onComplete 中 `currentSelectedFileMatch = undefined`（L1868）只是内部高亮状态，不影响树 selection。

**对原型的影响**：「点击 → 打开文档 → 扩展读树选中」的时序窗口存在（open 不清选中），但窗口会被下一次 doSearch 关闭；快照要趁早。

## 6. 键盘/命令驱动力（1.82.3 命令注册表）

**结论**：搜索相关 action 注册于 7 个文件（`browser/search.contribution.ts` L39-45 import：searchActionsCopy / Find / Nav / RemoveReplace / Symbol / TopBar / TextQuickAccess）；对原型最关键的三件：**openResult（打开焦点条目）、focusNext/focusPreviousSearchResult（移动树内选中）、copy 三件套（读选中）**——都可 `executeCommand` 驱动。

证据（各文件实际读到的注册行）：

- **`search.action.openResult`**（`browser/searchActionsNav.ts` L174-208）：Enter 触发；run 取 `tree.getFocus()[0]`（**用 focus 而非 selection**），`searchView.open(focus, false, false, true)`；focus 为 FolderMatch 时改为展开/折叠（L201-203）。无 precondition，扩展可执行。`search.action.openResultToSide`（L210-236）同型。
- **`search.action.focusNextSearchResult`**（Nav L395-416）：F4，`f1: true`，**precondition `HasSearchResults || InSearchEditor`**（L409，无结果时 executeCommand 被拒）；run → `searchView.selectNextMatch()`（Nav L498-509）。`selectNextMatch`（searchView.ts L956-999）：从当前 selection 出发导航，**跳过非 Match 节点直到 Match**（L977-985），然后 `setFocus + setSelection + reveal`（L992-995）——**只移动选中，不打开文件**；无选中时从第一个匹配开始（L972-975）。`search.action.focusPreviousSearchResult`（Nav L418-439，Shift+F4）对称，selectPreviousMatch 在 searchView.ts L1001-1042。
- **`search.action.copyMatch` / `copyPath` / `copyAll`**：见第 1-3 节；均无 precondition。
- 其余注册（grep `id: Constants.` 于六个已下载 actions 文件，31 处）：remove / replace / replaceAllInFile / replaceAllInFolder（searchActionsRemoveReplace.ts）、replaceInFiles（Nav L441+）、addCursorsAtSearchResults（Nav L238-262）、revealInSideBar、restrictSearchToFolder、excludeFromSearch（searchActionsFind.ts L130-161 一带）、toggleSearch{CaseSensitive,WholeWord,Regex,PreserveCase}、collapse/expand/clearSearchResults、viewAsTree/viewAsList、cancel、refreshSearchResults、focusSearchList、focusSearchFromResults、focusActiveEditor、focus.nextInputBox/previousInputBox、clearHistory、openInEditor 等。id 字符串表：`common/constants.ts` L8-50。

**对原型的影响**：扩展可以在无用户交互的情况下把树选中移到任意匹配（focusNext 循环遍历）再 copyMatch 读取，也能强制重放「打开选中结果」（openResult）——闭环的驱动件齐了。

## 7. findInFiles 参数（1.82.3）

**结论**：`workbench.action.findInFiles` 接受单对象参数，可带 `query` 直填搜索框，`triggerSearch: true` 立即触发搜索——**可程序化发起并驱动一次工作区搜索**。

证据（`browser/searchActionsFind.ts`）：

- 注册 L164-217，id = `Constants.FindInFilesActionId` = `workbench.action.findInFiles`（constants.ts L8），args schema L177-197：

  ```ts
  // L180-195（schema properties）
  query: { 'type': 'string' },
  replace: { 'type': 'string' },
  preserveCase: { 'type': 'boolean' },
  triggerSearch: { 'type': 'boolean' },
  filesToInclude: { 'type': 'string' },
  filesToExclude: { 'type': 'string' },
  isRegex: { 'type': 'boolean' },
  isCaseSensitive: { 'type': 'boolean' },
  matchWholeWord: { 'type': 'boolean' },
  useExcludeSettingsAndIgnoreFiles: { 'type': 'boolean' },
  onlyOpenEditors: { 'type': 'boolean' },
  ```

- handler 链：run（L214-216）→ `findInFilesCommand`（L353-408）。字符串参数先经 `configurationResolverService.resolveAsync` 解析 `${...}` 变量（L369-375）；随后按 `search.mode` 分派——默认 `'view'`（`browser/search.contribution.ts` L177 `default: 'view'`）：

  ```ts
  // L380-391（节选，view 模式）
  openSearchView(viewsService, false).then(openedView => {
      if (openedView) {
          ...
          openedView.setSearchParameters(args);
          ...
  ```

- `setSearchParameters`（searchView.ts L1356-1390）：`query` 字符串写入搜索输入框（L1372-1374）；`triggerSearch === true` 时调 `this.triggerQueryChange()`（L1382-1384）立即搜索。

**对原型的影响**：原型可用 `executeCommand('workbench.action.findInFiles', { query, triggerSearch: true })` 复现/自建一次搜索（例如对当前文档关键词反查），作为「读取通道」的前置驱动。

## 8. 搜索完成信号（1.82.3）

**结论**：**扩展公开 API 层面没有任何「搜索完成/结果更新」事件**；工作bench 内部只有 `searchState` context key（Idle/Searching/SlowSearch）随生命周期翻转，而扩展 API 无法直接读 context key。

证据：

- `src/vs/vscode.d.ts` @1.82.3 全文 grep `searchUIState` / `onDid.*Search` / `SearchResult`：**0 命中**。
- 内部状态：`common/search.ts` L218-224：

  ```ts
  export enum SearchUIState { Idle, Searching, SlowSearch }
  export const SearchStateKey = new RawContextKey<SearchUIState>('searchState', SearchUIState.Idle);
  ```

  流转于 searchView.ts `doSearch`：L1612 `this.state = SearchUIState.Searching`；L1614-1617 超 2 秒置 SlowSearch；onComplete L1620-1621 置 Idle。进度经 `progressService.withProgress`（L1606-1609），同样无扩展可读事件。
- 间接信号面：`vscode.commands.onDidExecuteCommand` 只覆盖命令路径（F4 / Enter / 复制等）；**鼠标单击打开匹配不走 CommandsRegistry**（走 tree.onDidOpen → searchView.open，见第 5 节），故点击行为本身对命令监听器不可见。

**对原型的影响**：「等搜索完成再读」没有一等公民信号；要么用「文档被打开」这一编辑器侧事件做触发（vsidian 的 custom editor 本身就是打开方），要么轮询式地读 copyAll 并比对。

---

## 原型可行性速判

**基于源码，copyMatch + copyPath 组合不能独立恢复完整目标；补上「激活文档即被点击的文件」这一侧信息后，可恢复到「文件路径 + 匹配起点（行,列）」，但「结束位置」始终缺失。**

按点击对象分型：

- **点 Match 级条目**（展开树中的单条匹配，最常见路径）：
  - copyMatch 给 `startLine,startCol: 行文本`（searchActionsCopy.ts L173-198）——**无路径、无终点**；
  - copyPath 对 Match 级选中静默不写（L116-120）——路径通道为空；
  - 路径只能由 vsidian 侧推断：点击必然 `editorService.openEditor` 打开该文件（searchView.ts L1900），custom editor 被打开即知道 resource。两者拼接 = 文件 + 起点。
- **点 FileMatch 级条目**（文件节点）：
  - copyMatch 输出「路径 + 全部匹配各自的起点行列」（L208-217），信息完整可用；
  - 原生语义本就是「定位最后一个匹配」（getEditorSelectionFromMatch L2160-2161），原型复刻该语义即可对齐用户预期。

**缺口清单**（按severity排序）：

1. **结束位置缺失**：copy 通道所有输出只含起点行列；match 内部的完整 range（含终点）不进任何可读文本。补救：拿到起点后由 vsidian 在目标行内重算（用当前查询词重匹配），或退化为「定位到行/选中整行」。
2. **剪贴板污染**：三个 copy 命令都 `clipboardService.writeText`，且 executeCommand 返回值不含文本；原型需保存/恢复用户剪贴板，并接受瞬时不一致。main 的 `getSearchResults` 是干净的返回值通道但 1.82.3 没有。
3. **触发面**：鼠标点击不走命令注册表（第 8 节），扩展感知点击只能靠「目标文档被打开」侧的事件；且**文档已是激活编辑器时再点同文件另一条匹配，激活事件不翻转**——需要额外触发面（如在文档可见性/selection 侧兜底），这是集成层风险，源码无法替它背书。
4. **选中生命周期**：选中在 open() 后保留，但下一次 doSearch 立即清空（searchView.ts L1744-1745）；searchOnType 下用户后续击键会关掉窗口。读取须在打开事件后尽快快照。

**加分项**：命令驱动力完整——focusNext/PreviousSearchResult 可在无用户交互下移动树选中（无结果时被 precondition 拒绝，Nav L409），openResult 可重放打开；findInFiles 可带 query + triggerSearch 程序化发起搜索（Find L177-197 + searchView L1372-1384）。原型可以完全走「扩展侧编排 + 剪贴板中转」的路线，不需要改 VSCode 本体。

---
