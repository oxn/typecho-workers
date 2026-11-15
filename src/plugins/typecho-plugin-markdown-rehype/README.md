# Markdown Rehype

本插件正在将 [Rin](https://github.com/oxn/Rin) 的文章 Markdown 渲染实现移植到 Typecho。当前阶段只处理文章内容渲染，不扩展额外 Markdown 语法，也不接管主题页面布局。

## 渲染基准

文章解析以 Rin 的 `client/src/components/markdown.tsx` 为基准：

- remark：GFM、Mermaid 双主题结构、数学公式、GitHub Blockquote Alerts、软换行。
- rehype：KaTeX、原始 HTML 解析。
- 文章组件：标题、段落、链接、引用、列表、任务列表、表格、脚注、上下标和 iframe。
- 图片：URL 元数据、宽高、BlurHash 占位、加载状态、失败占位、行内/块级尺寸。
- 图片查看：灯箱、下载、缩放和计数。
- 代码：Prism 语法高亮、Ateliersulphurpool Light / VS Code Dark Plus 配色、长行换行和复制。
- Mermaid：亮色和暗色两套图表容器，随页面颜色模式切换。

## 插件边界

- Markdown 解析和文章交互由本插件完成，文章根节点为 `.toc-content`。
- 主题只提供页面框架以及当前主题的颜色模式；不调用主题自己的 Markdown 渲染器。
- 前台文章与后台预览共用同一份 Markdown 解析输出和浏览器运行时。
- 插件保留 HTML 安全过滤，不开放脚本、事件处理器等可执行内容。
- 当前后台设置字段暂时保留界面，但不参与渲染；待 Rin 文章渲染完整复刻后再接入。

## 版权

Rin 派生和适配代码遵循 MIT License，版权归属及完整许可文本见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## 当前进度

迁移仍在进行中。静态代码提交不等于浏览器运行时验证；在用户完成本地构建与实际文章对照前，不标记为最终交付。
