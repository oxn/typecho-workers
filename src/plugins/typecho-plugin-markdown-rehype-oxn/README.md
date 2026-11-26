# Markdown Rehype OXN

独立的前端文章增强插件。只处理主题已经输出的 HTML，不注册 `content:markdown` 或 `content:content` 过滤器，不接管 Markdown 解析，也不写入数据库。

## 功能
- **数学公式**：KaTeX 自动识别 `$...$`、`$$...$$`、`\\(...\\)`、`\\[...\\]`。
- **Mermaid**：识别 `pre > code.language-mermaid`，生成明暗两套流程图，支持主题明暗切换。
- **代码高亮**：Refractor 5 语言注册表。只替换现有 `code` 子节点，不替换 `pre`，不创建或移除复制按钮。

## 独立开关
插件设置分别提供数学公式、Mermaid、代码高亮三个开关。关闭的功能不会加载对应浏览器运行时；依赖由本地 workspace 构建，不使用 CDN。

## 运行机制
通过 `archive:header` 注入样式，通过 `archive:footer` 加载主入口。主入口只扫描 `.toc-content` 中已经生成的 DOM，并按页面实际内容加载对应功能包。支持 InstantClick 页面切换及重复初始化。

不修改主题、其他插件、数据库或 Markdown 核心解析流程。运行时代码和样式均保存在本插件目录。
