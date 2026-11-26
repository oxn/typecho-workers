# Markdown 显示增强

独立的前端显示增强插件，仅处理页面已经输出的文章和独立页面 DOM，不参与 Markdown 解析，不改写文章内容，不读写数据库。

## 功能

- 数学公式：KaTeX 0.16.22
- Mermaid 图表：Mermaid 11.12.0
- 代码语法高亮：Highlight.js 11.11.1

三个功能均可在插件设置中独立启用或关闭。Mermaid 渲染会保留原始代码块，避免破坏主题已有的代码复制按钮。

## 本地资源

所有运行资源均保存在本插件目录内的 assets 目录，不依赖主题目录、其他插件目录或外部 CDN：

- KaTeX：浏览器 JS、自动渲染扩展、CSS，以及 WOFF2、WOFF、TTF 全部字体文件
- Mermaid：官方 11.12.0 浏览器发行包
- Highlight.js：11.11.1 浏览器发行包、GitHub 明暗两套样式

第三方许可证文本保存在 licenses 目录：KaTeX 与 Mermaid 使用 MIT，Highlight.js 使用 BSD-3-Clause。

资源请求使用插件自己的 early-request provider，路径为 /plugins/typecho-plugin-markdown-display/assets/。构建时由 Vite 将插件目录内的资源纳入 Worker 静态资产，运行时由插件 provider 通过 ASSETS 返回。该路径在常规 D1 初始化之前处理，因此资源请求不触发 D1/KV 读取，也不产生数据库写入。

## 页面与主题兼容

只在 post 和 page 页面注入对应资源。插件通过项目公共 archive:header / archive:footer 注入机制工作，不依赖 OXN 主题；主题需使用项目公共布局插件注入机制。

关闭某项功能时，不会输出该功能对应的 CSS 或脚本请求。所有资源同源加载，不使用 jsDelivr 或其他外部 CDN。
