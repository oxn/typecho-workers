# Markdown 增强

为站点 Markdown 内容增加数学公式、Mermaid 图表和代码高亮，作为独立插件供不同主题复用。

## 功能

- 行内公式：`$...$` 与 `\(...\)`。
- 块级公式：独立行 `$$` / `\[` 开始、`$$` / `\]` 结束；单行 `$$...$$` 也支持。
- Mermaid：标准 fenced code block，例如 ```mermaid。
- 代码高亮：通过 Prism.js 处理带语言标记的 fenced code block。
- 前台与文章/页面编辑器预览区域按需加载本地脚本和样式；没有数学公式、Mermaid 图表或带语言代码块时，不加载对应大型运行库。

## 安全边界

- 只通过 `content:markdown` 将数学语法转换为普通 Markdown code span / fenced code block。
- 不注入原始 HTML，不修改核心 Markdown sanitizer，不扩展文章 HTML/SVG 白名单。
- KaTeX 使用 `trust: false` 并输出原生 MathML；渲染结果经本站 `/vendor/purify.js` 再写入 DOM，不依赖 KaTeX Web 字体。
- Mermaid 使用 `securityLevel: 'strict'`，生成的 SVG 经过 DOMPurify 清理。
- 不接管评论 Markdown；评论仍走上游独立且更严格的 sanitizer。
- Notes 正文使用同步 SDK Markdown renderer，不经过 `content:markdown`；客户端会在笔记正文中识别行内公式并处理标准 Mermaid / code fences。

## 资源

客户端资源放在插件自己的 `client/` 目录，由项目现有 client-loader 本地打包至 `/plugin-assets/typecho-plugin-markdown/`。KaTeX、Mermaid 与 Prism 通过轻量 loader 按页面内容懒加载，避免每次访问都下载全部库。
