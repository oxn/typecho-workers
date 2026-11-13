# 更新日志

## 2026.11.13.10.49（北京时间）

### 新增与改进
- Mermaid 代码块输出浅色/深色双份结构，沿用 Rin 的双主题节点机制。
- 完善 KaTeX / MathJax 两种公式引擎的处理路径。
- 增强 WordPress/Gutenberg 常见 HTML 区块属性兼容。
- 改善缩进 HTML 与嵌套 HTML 的 Markdown 解析兼容。
- 保留 HTML sanitize 白名单与 iframe 安全约束。

### 兼容说明
- Mermaid 和 MathJax 的浏览器端执行目前仍由 Warm CY 主题接入；其他主题需自行适配。
- 本次没有改变 Typecho 核心文件，也没有执行线上部署。
