# Typecho Warm CY

**主题版本：** 2026.11.13.10.49（北京时间）

基于 Typecho Warm 的独立自定义主题，适用于 Typecho-Workers。主题负责页面模板、文章排版、交互和视觉样式，并与 Markdown Rehype 插件配合呈现文章内容。

## 本次版本内容
- 目录实时跟随文章阅读位置，当前章节自动滚动到目录可视区域中间。
- 目录章节文字默认收起，桌面端鼠标悬停或键盘聚焦目录时显示；移动端保留触屏可读方式。
- 代码块复制按钮统一中文提示；普通代码块和高亮代码块均支持复制，桌面端悬停显示，触屏设备可用。
- Mermaid 流程图支持浅色/深色主题节点的前端渲染。
- KaTeX / MathJax 公式显示样式和 Mermaid SVG 布局样式。
- WordPress/Gutenberg 常见图片、标题、段落、列表、引用、表格及布局 HTML 样式兼容。
- 修正 Markdown 提示块内粗体文字颜色继承。

## 配套插件
推荐同时启用 typecho-plugin-markdown-rehype。
- 插件负责 Markdown 解析、HTML 转换和安全过滤。
- 插件默认使用 KaTeX 服务端渲染；MathJax 和 Mermaid 需要浏览器端运行时。
- 当前浏览器端 Mermaid / MathJax 渲染逻辑位于主题的 WarmShell.astro，相关显示样式位于 style.css。
- 其他主题可复用插件输出，但需要自行接入 Mermaid / MathJax 运行时和样式；当前并非开箱即用的跨主题渲染方案。

## 注意事项
- 不修改 Typecho 核心文件。
- 文章 HTML 兼容不代表允许任意脚本执行；插件仍会对原始 HTML 做安全过滤。
- 主题的目录与插件自带目录不要同时开启，以免重复生成。
