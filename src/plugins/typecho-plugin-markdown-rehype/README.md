# Markdown Rehype

本插件将 [Rin](https://github.com/oxn/Rin) 的 Markdown 内容输出实现移植到 Typecho，统一负责文章与独立页面的 Markdown 解析、HTML 输出及浏览器交互。主题继续负责页面框架和布局，正文内容由插件渲染。

## 渲染基准

文章与独立页面的正文解析以 Rin 的 `client/src/components/markdown.tsx` 为基准：

- remark：GFM、Mermaid 双主题结构、数学公式、GitHub Blockquote Alerts、软换行。
- rehype：KaTeX、原始 HTML 解析。
- 正文组件：标题、段落、链接、引用、列表、任务列表、表格、脚注、上下标和 iframe。
- 图片：URL 元数据、宽高、BlurHash 占位、加载状态、失败占位、行内/块级尺寸。
- 图片查看：灯箱、下载、缩放和计数。
- 代码：完整 Prism 语言注册表、Ateliersulphurpool Light / VS Code Dark Plus 配色、长行换行和复制；仅在文章存在代码块时加载高亮运行时。
- Mermaid：亮色和暗色两套图表容器，随页面颜色模式切换。

## 插件边界

- 文章与独立页面均通过共享内容过滤入口调用本插件；插件也导出 `renderMarkdown(source)`，可直接渲染正文 HTML。输出根节点为 `.toc-content`。
- 主题只提供页面框架以及当前主题的颜色模式；不调用主题自己的 Markdown 渲染器。
- 前台文章、独立页面与后台预览共用同一份 Markdown 解析输出和浏览器运行时。
- 插件保留 HTML 安全过滤，不开放脚本、事件处理器等可执行内容。
- 后台设置由插件直接读取 `plugin:typecho-plugin-markdown-rehype` 配置，并参与文章渲染；前台文章与后台预览使用相同配置。

## HTML 安全白名单设置

- **原始 HTML 标签白名单**：管理额外允许出现的标签。支持换行、空格、逗号和分号分隔；留空时不额外放行标签。脚本、对象嵌入及文档级危险标签始终禁止。
- **原始 HTML 属性白名单**：按标签逐行配置，格式为 `abbr: title, class`。只允许插件定义的安全属性映射，不接受事件属性或危险属性。留空时不额外放行这些可选属性。
- **iframe 属性白名单**：管理 iframe 可保留的属性。白名单只允许属性通过，不会自动添加属性；`src` 仍受安全 URL 规则约束，`srcdoc`、`nonce`、`integrity` 和所有 `on*` 事件属性始终禁止。留空时恢复内置默认属性。
- 配置保存后会清理 Markdown 输出缓存及白名单缓存；处理器按当前配置生成并复用，前台和后台预览保持一致。

## 版权

Rin 派生和适配代码遵循 MIT License，版权归属及完整许可文本见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## 当前进度

迁移仍在进行中。静态代码提交不等于浏览器运行时验证；在用户完成本地构建与实际文章对照前，不标记为最终交付。
