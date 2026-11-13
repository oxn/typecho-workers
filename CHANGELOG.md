# 更新日志

## 2026-11-13 10:49（北京时间，UTC+8）

### Markdown Rehype 插件（2026.11.13.10.49）
- 完善 GFM、原始 HTML 安全处理和 WordPress/Gutenberg 常见区块兼容。
- Mermaid 代码块输出浅色/深色双主题结构。
- 保留 KaTeX（默认）与 MathJax 两种公式引擎。
- 记录当前主题依赖边界：Mermaid 与 MathJax 浏览器端执行仍由 Warm CY 主题接入。

### Typecho Warm CY 主题（2026.11.13.10.49）
- 目录随文章当前章节实时滚动，并将当前章节定位在目录中部。
- 目录文字默认隐藏，桌面端悬停/聚焦后显示。
- 代码复制支持普通代码块与高亮代码块，中文反馈，桌面端悬停显示。
- 配合插件改善 WordPress/Gutenberg 文章 HTML、公式与流程图显示。

### 构建与部署核查
- 用户提供的本地记录显示 Astro build 完成、Wrangler 本地服务启动成功。
- MathJax 第三方 bundle 产生 direct eval 构建警告；不是本次构建失败。
- 本地构建日志不等同于 Cloudflare 线上部署记录。
- 线上部署历史仍需在 Cloudflare Workers Builds / Deployments 控制台核实；本次未执行部署。


## 2026-11-13 文档核对与同步

- 按当前 `master` 的插件、主题源码重新核对说明文件，修正 AntiSpam 时间令牌的签发时机说明。
- 补充 Edge Cache 的开发模式绕过策略与 D1 过期缓存清理说明。
- 补充 Markdown Rehype 的图片尺寸语法与 SVG 安全处理边界。
- 更新内置插件目录、Warm CY 配套插件版本信息及主题使用说明。
- 本次为文档同步提交，不代表新增线上功能；未修改 Typecho 核心文件，未执行 Cloudflare 生产部署。
