# Markdown Rehype

**插件版本：** 2026.11.13.10.49（北京时间）

为 Typecho-Workers 提供统一的 Markdown 转换与 HTML 安全处理流程。插件负责内容解析和 HTML 结构生成；公式、流程图的部分浏览器端渲染仍需主题配合。

## 功能
- CommonMark 与 GFM：表格、任务列表、删除线、自动链接等。
- 中文友好解析、Emoji、GitHub 风格提示块。
- 代码高亮、代码标题、行内标记与灵活容器。
- 原始 HTML 解析与安全白名单过滤。
- WordPress/Gutenberg 常见区块属性兼容，包括图片、段落、标题、列表、引用、表格及常见布局容器。
- 数学公式：KaTeX 服务端渲染（默认），或 MathJax 浏览器端渲染。
- Mermaid：识别 Mermaid 代码块并生成浅色、深色两套待渲染结构。
- 可选目录生成、iframe 属性白名单配置。

## 配置
| 配置项 | 默认值 | 说明 |
|---|---|---|
| 数学公式引擎 | KaTeX | KaTeX 服务端渲染；MathJax 支持更广泛的 TeX 语法，但需要浏览器端运行时 |
| Rehype 目录 | 关闭 | 仅在 Markdown 存在“## 目录”标题时生成，避免与主题目录重复 |
| iframe 属性白名单 | 内置白名单 | 每行一个属性名；危险事件属性、src 和 srcdoc 不允许通过此配置开放 |

## 主题兼容说明（重要）
当前版本还不是完全脱离主题的通用前端渲染插件：
1. 插件负责 Markdown 解析、公式处理（KaTeX）及 Mermaid 双主题结构输出。
2. Warm CY 主题的 WarmShell.astro 负责加载 Mermaid 浏览器运行时、执行 Mermaid 渲染，并处理 MathJax 的浏览器端排版。
3. Warm CY 的 style.css 提供公式、流程图及 Markdown 内容的显示样式。
4. 其他主题可以复用插件生成的 HTML，但若要完整显示 Mermaid、MathJax 和主题化样式，需要自行接入对应运行时与 CSS。

因此，当前版本在本项目中与 Warm CY 完整配套；不能承诺安装到任意 Typecho 主题后无需适配即可呈现相同效果。后续可继续把浏览器端渲染入口收敛到插件，主题只保留外观覆盖。

## 安全说明
- 原始 HTML 会经过解析和 sanitize 白名单过滤。
- script 等未获准标签不会因为启用原始 HTML 解析而自动执行。
- iframe 仅保留允许的属性；危险事件属性、src、srcdoc 不允许通过自定义白名单放开。
- 不建议为了消除控制台提示而吞掉渲染异常或隐藏错误日志。

## 使用注意
- 与 CY 服务插件的“正文 HTML / CSS / JavaScript 增强”功能存在处理冲突；启用本插件时请关闭该选项。
- 若主题已生成自己的文章目录，请保持插件的 Rehype 目录选项关闭。
- 默认建议使用 KaTeX；只有需要更广泛 TeX 语法时再切换 MathJax。

## 目录
- index.ts：Markdown 解析、转换和安全过滤入口。
- mermaid-config.ts：Mermaid 配置。
- client/mermaid-runtime.ts：供构建器打包的 Mermaid 浏览器运行时入口。
- iframe-allowlist.test.ts、svg-compat.test.ts：安全白名单与 SVG 兼容回归测试。
