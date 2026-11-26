# Markdown Rehype OXN

独立的前端文章增强插件。只处理主题已经输出的 HTML，不注册 `content:markdown` 或 `content:content` 过滤器，不接管 Markdown 解析，也不写入数据库。

## 功能
- **数学公式**：KaTeX 自动识别 `$...$`、`$$...$$`、`\\(...\\)`、`\\[...\\]`。
- **Mermaid**：识别 `pre > code.language-mermaid`，生成明暗两套流程图，保留原有 `pre` 内的主题复制控件，并支持主题明暗切换。
- **代码高亮**：Refractor 5 语言注册表。只替换现有 `code` 子节点，不替换 `pre`，不创建或移除复制按钮。

## 独立开关
插件设置分别提供数学公式、Mermaid、代码高亮三个开关。关闭的功能不会加载对应浏览器运行时；依赖由本地 workspace 构建，不使用 CDN。

## 运行机制
通过 `archive:header` 注入样式，通过 `archive:footer` 加载主入口。主入口扫描 `.warm-prose`、`.toc-content` 和 `[itemprop="articleBody"]` 中已经生成的 DOM，并按页面实际内容加载对应功能包。支持 InstantClick 页面切换及重复初始化。

浏览器运行时源码位于本插件的 `client/src/`，插件自己的 `scripts/build-client.mjs` 负责生成 `client/dist/`。插件包安装时会通过自身的 `postinstall` 执行构建；也可以在插件目录执行 `bun run build:client` 手动构建。KaTeX 字体会内嵌到插件生成的 CSS 中。运行时由插件自己的 `route:request` 路由（`/__plugin-assets/`）提供，不写入 `public/`。

不修改主题、其他插件、数据库或 Markdown 核心解析流程。资源源码、构建脚本和生成目录均位于本插件目录；`client/dist/` 是本插件构建生成目录。
