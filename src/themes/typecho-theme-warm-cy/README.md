# Typecho Warm CY

**主题版本：** 2026.11.18.22.04（北京时间）

面向 Typecho-Workers 的独立 Warm 风格主题。主题采用统一 CY Client Runtime：以 Astro 页面外壳承载主题自有 Renderer，由主题负责页面模板、文章与独立页面正文的 Markdown/HTML 处理、DOM 渲染、主题交互和视觉样式。

前台正文渲染不依赖 Markdown 插件包；无需启用 Markdown Rehype 插件。CY 服务插件也不承担正文解析或渲染职责，只提供后台管理与主题配置能力。

## 主题职责

- Astro 页面外壳、页面模板、文章排版与主题视觉样式。
- 统一 CY Client Runtime 与主题自有正文 Renderer。
- 文章及独立页面的 Markdown/HTML 内容处理和 DOM 输出。
- 正文 HTML 增强、样式处理及相关客户端运行时。
- 文章目录展示与阅读位置跟随。
- 导航、搜索入口、明暗模式及主题交互。
- 页脚、主题设置与 CY 服务插件的配置衔接。
- 笔记媒体网格及附件展示。
- 本站上传图片的 URL 优化参数。

## Markdown 解析与渲染

主题在自身 Renderer 中使用 **Unified / Remark / Rehype** 处理管线，将 Markdown 转换为 HTML，并由主题的 CY Client Runtime 完成后续 DOM 输出与交互。处理流程概括如下：

1. `unified` 组织内容处理管线。
2. `remark-parse` 解析 Markdown；`remark-gfm`、`remark-breaks`、`remark-github-blockquote-alert` 和 `remark-math` 分别提供 GFM、换行、GitHub 风格提示框和数学公式语法支持。
3. `remark-rehype` 将 Markdown 语法树转换为 HTML 语法树，`rehype-raw` 处理内容中的原生 HTML。
4. `rehype-katex` 处理数学公式，`rehype-stringify` 输出 HTML。
5. `katex` 提供公式渲染能力，`refractor` 提供代码语法高亮，`mermaid` 提供流程图渲染。

以上解析与渲染能力由主题直接依赖并组织，不通过 `typecho-plugin-markdown-rehype` 调用，也不要求安装或启用该插件。第三方库仍归各自项目及其权利人所有；各依赖的版权与许可应以对应发行包内的许可证文件和上游项目声明为准。主题自身的 MIT 许可不替代第三方依赖各自的许可义务。

## CY 服务插件职责

CY 服务插件只负责后台管理与主题配套设置，包括：

- 首页文章置顶管理及相关操作。
- 评论区管理入口及管理员操作信息。
- 搜索入口相关的后台设置。
- 页脚链接、文章内容声明和站点底部自定义 HTML。
- 主题设置界面的整理及 CY 服务插件后台入口。

CY 服务插件不注册正文内容处理钩子，不负责 Markdown/HTML 正文渲染，也不向正文注入渲染运行时。主题前台不依赖 Markdown 插件包。

## 主题设置与媒体显示

主题设置包括：

- **内容列表加载**：手动、滚动加载 2 次、无限滚动。
- **评论组件加载**：手动、停留 3 秒加载、自动加载。
- **评论列表加载**：手动、自动加载第一页、滚动加载 2 次、无限滚动。
- **图片优化参数**：分别为正文原图与缩略图追加安全过滤后的查询参数；只处理识别为本站上传目录的图片，不改写 GIF、SVG 或外站图片。
- **页脚与导航**：页脚链接、RSS、可选自定义页脚 HTML；笔记插件启用时主导航显示笔记入口。

笔记媒体由 `WarmNoteMedia.astro` 呈现：图片网格最多先显示 4 张，更多图片可展开并进入查看器；视频和音频使用原生控件；其他附件以文件链接呈现。附件分桶数据由 Notes 插件提供。

## 来源与致谢

本主题在部分界面交互与图标呈现方面参考了 **Rin（OpenRin）** 项目。感谢 Rin 项目作者及贡献者的开源工作。

- 项目名称：Rin
- 项目地址：https://github.com/openRin/Rin
- 开源许可：MIT

本主题是面向 Typecho-Workers 的独立实现与适配，并非 Rin 项目的官方版本。Rin 项目的名称、版权及其原有许可归原项目权利人所有。

## 注意事项

- 不修改 Typecho 核心文件。
- 正文渲染由主题自有 Renderer 负责，不要求启用 Markdown Rehype 插件。
- CY 服务插件与主题分工独立：插件负责后台管理，主题负责前台页面与正文输出。
- 主题的目录与插件自带目录不要同时开启，以免重复生成。
