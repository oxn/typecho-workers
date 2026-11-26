# Markdown Rehype OXN

独立的前端文章增强插件。只处理主题已经输出的 HTML，不注册 `content:markdown` 或 `content:content` 过滤器，不接管 Markdown 解析，也不写入数据库。

## 功能
- **数学公式**：KaTeX 自动识别 `$...$`、`$$...$$`、`\\(...\\)`、`\\[...\\]`。
- **Mermaid**：识别 `pre > code.language-mermaid`，生成明暗两套流程图，保留原有 `pre` 内的主题复制控件，并支持主题明暗切换。
- **代码高亮**：Refractor 5 语言注册表。只替换现有 `code` 子节点，不替换 `pre`，不创建或移除复制按钮。
- **BlurHash 图片预览**：识别图片 URL 片段中的 `blurhash`、`width`、`height`，提取后从 `src` 中移除附加参数，使用插件本地解码器显示模糊占位图；原图加载完成后恢复清晰图片。未携带 `blurhash` 参数的图片不处理。

## 独立开关与资源加载方式
插件设置分别提供数学公式、Mermaid、代码高亮和 BlurHash 四个功能开关，并提供“资源加载方式”选项：

- **按需加载（默认）**：浏览器先执行轻量 DOM 检测；只有文章中确实存在已启用的公式、Mermaid 流程图、受支持语言的代码块或 BlurHash 图片时，才加载对应 CSS 和运行时。普通文章不会下载用不到的增强资源，代价是执行一次轻量内容检测。
- **全量加载**：不检测文章内容；只要某项功能开关已启用，就直接加载该功能对应的 CSS 和运行时。省去内容检测，但普通文章也可能下载并执行实际用不到的资源。

关闭的功能在两种模式下都不会加载对应运行时。依赖由本地 workspace 构建，不使用 CDN。

## 运行机制
通过 `archive:footer` 加载轻量主入口。按需模式扫描 `.warm-prose`、`.toc-content` 和 `[itemprop="articleBody"]` 中已经生成的 DOM，并按页面实际内容加载对应功能包；全量模式则直接初始化所有已开启功能。支持 InstantClick 页面切换及重复初始化。

浏览器运行时源码位于本插件的 `client/src/`，插件自己的 `scripts/build-client.mjs` 负责生成 `client/dist/`。本插件提供的 Astro 构建集成会在 `astro build` 和 `astro dev` 的配置阶段先执行该脚本，再加载插件入口，因此干净环境只要安装了项目构建依赖，便不依赖 Bun 是否执行 workspace 的 `postinstall`。也可以在插件目录执行 `bun run build:client` 手动构建。KaTeX 字体会内嵌到插件生成的 CSS 中。运行时由插件自己的 `route:request` 路由（`/__plugin-assets/`）提供，不写入 `public/`。

不修改主题、其他插件、数据库或 Markdown 核心解析流程。资源源码、构建脚本和生成目录均位于本插件目录；`client/dist/` 是本插件构建生成目录。


## 懒加载与动态内容更新

- Mermaid 使用 `IntersectionObserver` 观察即将进入视口的流程图，提前量为 `300px`；进入观察范围后再加载/执行对应渲染流程。渲染完成后停止观察，避免重复渲染。
- 不通过 scroll 事件反复扫描流程图。
- 首次加载检测文章内容区域；后续 AJAX 新增内容只检测新增片段 root 及其子树，不重新扫描整个 `.post-content`。
- InstantClick 切换页面后继续检测新页面内容。运行时的选择器、观察器和状态由本插件独立维护。
- 上述动态检测也负责发现新增片段中的 BlurHash 图片；只检测新增片段，不因 AJAX 更新而重新扫描整篇文章。各功能资源仍按页面实际内容及后台开关按需加载。
