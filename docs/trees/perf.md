# 性能实测归档视图

file-tree 视图（id: `perf`）：`docs/perf` 全量子树投影（实测报告与原始数据）。主树中该目录已折叠，在此展开。数据源自 tree.json，随文件变更自动同步渲染；块内内容禁止手改。

```
<!-- file-tree:tree^id=perf:begin 由脚本渲染，禁止手改 -->
vsidian/
└── docs/
    └── perf/ # 性能实测数据与测量工具说明
        ├── 2026-09-browser-test-runner.md             # 浏览器测试调度实测
        ├── 2026-09-code-block-card.md                 # 代码块卡片性能实测（#85）
        ├── 2026-09-hover-preview-embed-performance.md # 悬停与嵌入一期性能实测（#225）
        ├── 2026-09-live-syntax-decorations.md         # 语法树装饰与大围栏细分实测（#8）
        ├── 2026-09-math-rendering.md                  # 公式渲染性能实测（#59）
        ├── 2026-09-mermaid-rendering.md               # Mermaid 性能与边界（#60）
        ├── 2026-09-mvp-performance-summary.md         # MVP 性能档位汇总
        ├── 2026-09-reading-viewport-mount.md          # 阅读按需挂载实测数据
        ├── 2026-09-table-cell-editing.md              # 表格单元格编辑性能实测（#12）
        ├── 2026-09-title-decoration-viewport.md       # 标题切片视口渲染实测数据
        ├── 2026-09-vault-index-storage.md             # 索引存储选型三档基准解读（#195）
        ├── 2026-10-hit-reveal-budget.md               # 命中显形重建预算实测（#251）
        ├── 2026-10-ref-expansion-244.md               # 递归引用驻留实测
        ├── 2026-10-ref-phase15-249.md                 # 1.5 期收口资源实测汇总（#249）
        └── data/                                      # 性能探针原始报告数据
            ├── browser-test-runner.json               # 浏览器调度实测数据
            ├── hover-embed-perf-host.json             # #225 真宿主编辑阻塞实测数据
            ├── hover-embed-perf.json                  # #225 状态层嵌入装饰实测数据
            ├── hover-refresh.json                     # #224 引用视图同步定向测量数据
            ├── perf-report.json                       # 性能探针原始报告数据
            ├── ref-expansion-244.json                 # 递归引用实测原始数据
            ├── ref-phase15-249.json                   # #249 资源实测原始报告数据
            ├── ref-virtual-243.json                   # 引用长文虚拟挂载原始数据
            ├── vault-index-storage-bench-recheck.json # #202 三档复测报告
            └── vault-index-storage-bench.json         # 索引存储基准原始数据（#195）
<!-- file-tree:tree^id=perf:end -->
```
