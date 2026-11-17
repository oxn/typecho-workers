# Markdown Rehype

本插件将 [Rin](https://github.com/oxn/Rin) 的 Markdown 内容输出实现移植到 Typecho，统一负责文章与独立页面的 Markdown 解析、HTML 输出及浏览器交互。主题继续负责页面框架和布局，正文内容由插件渲染。

## 渲染基准

文章与独立页面的正文解析以 Rin 的 `client/src/components/markdown.tsx` 为基准：

- remark：GFM、Mermaid 双主题结构、数学公式、GitHub Blockquote Alerts、软换行。
- rehype：KaTeX、原始 HTML 解析。
- 正文组件：标题、段落、链接、引用、列表、任务列表、表格、脚注、上下标和 iframe。
- 图片：URL 元数据、宽高、BlurHash 占位、加载状态、失败占位、行内/块级尺寸。
- 图片查看：灯箱、下载、缩放和计数。
- 代码：完整 297 种 Refractor 5 / Prism 语言注册表、Ateliersulphurpool Light / VS Code Dark Plus 配色、长行换行和复制；仅在文章存在代码块时加载高亮运行时。
- Mermaid：亮色和暗色两套图表容器，随页面颜色模式切换。

## 插件边界

- 文章与独立页面均通过共享内容过滤入口调用本插件；插件也导出 `renderMarkdown(source)`，可直接渲染正文 HTML。输出根节点为 `.toc-content`。
- 主题只提供页面框架以及当前主题的颜色模式；不调用主题自己的 Markdown 渲染器。
- 前台文章、独立页面与后台预览共用同一份 Markdown 解析输出和浏览器运行时。
- 原始 HTML 按 Typecho 的文章 Markdown 行为处理；插件不再维护标签、属性或 iframe 白名单，也不额外过滤 HTML。
- 后台不再提供 HTML 白名单设置；前台文章与后台预览共用同一套 Markdown 解析输出。

## 版权

Rin 派生和适配代码遵循 MIT License，版权归属及完整许可文本见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## 当前进度

迁移仍在进行中。静态代码提交不等于浏览器运行时验证；在用户完成本地构建与实际文章对照前，不标记为最终交付。
