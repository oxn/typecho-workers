# Warm CY 与跨主题功能迁移矩阵

本表以旧项目 `1f5bc6ce25bc99f0d9f52942c426c9652da168ea` 相对上游基线 `6f268808f4f510852887f18cf43fd88567d69e15` 的 45 个提交、52 个文件差异为核对范围。此阶段是源码审计结果，不代表功能已迁移或测试通过。

## Warm CY 主题功能

| 功能 | 归属 | 上游接口/依赖 | 迁移策略与当前判断 |
|---|---|---|---|
| 页面布局、导航、首页/文章/独立页/归档/404 | Warm CY 主题 | 主题模板组件映射、Theme props | 放入独立主题包；逐个对齐基线 Theme props |
| 页脚自定义 HTML | Warm CY 主题 | 主题配置 `theme:<id>` | 主题配置与模板渲染；HTML 允许范围需与站点安全策略一致 |
| 页脚链接（最多 10 组） | Warm CY 主题 | 主题配置 | 主题内解析、校验 URL 后渲染 |
| 首页文章置顶 | Warm CY 主题 | 主题配置 + 伴随插件 API | 首页按配置查询已发布文章；管理操作通过伴随插件路由更新同一配置 |
| 评论区管理员编辑/删除/置顶入口 | Warm CY 主题 UI + 专属伴随插件 | `comment:list`、`route:request`、`registerPluginAdminPath` | 插件扩展评论列表 payload；UI 在主题内显示；写操作使用原版管理员鉴权和 CSRF |
| 文章目录、阅读时间、摘要呈现 | Warm CY 主题 | 主题模板数据；摘要插件可选 | 主题内实现展示逻辑；智能摘要仍通过现有 intelligence 插件公开能力 |
| 连续加载/分页模式 | Warm CY 主题 | 原版分页 URL/数据 | 主题控制交互，不改核心分页 API |
| 评论组件延迟加载、评论列表加载模式 | Warm CY 主题 | 原版评论 API | 只改变组件加载和展示，不复制评论审核/身份/分页业务 |
| 播放器、页面切换保持、图片灯箱 | Warm CY 主题 | 浏览器端主题脚本 | 主题内实现；保留当前站内导航体验，不要求新窗口自动播放 |
| 图片 URL/内容图片优化 | Warm CY 主题 | 旧实现依赖核心 `image-transform` | 将必要的纯展示 URL 处理收回主题包，不改核心图像模块 |
| 笔记流/笔记媒体 | Warm CY 主题调用现有 Notes 插件 | `typecho-plugin-notes` 导出 | 只使用 Notes 插件现有导出；避免依赖核心私有 context 工具 |

## 跨主题插件能力

| 功能 | 归属 | 上游扩展点 | 迁移策略与边界 |
|---|---|---|---|
| 中文标题拼音别名 | 独立公共插件 | `admin:writePost:bottom`、`admin:writePage:bottom`、`post:write`、`page:write` | 先核实保存 Hook 是否覆盖 API/后台所有写入路径；手动别名和已有别名优先，不覆盖用户值 |
| Markdown 扩展/GitHub Alerts | 独立公共插件 | `content:markdown`、`content:content` | 明确文章/页面/摘要/RSS等路径覆盖范围；HTML/SVG 必须使用严格 allowlist 和 URL scheme 校验 |
| CSP 白名单扩展 | 独立公共插件或站点设置扩展 | `csp:directives` | 只扩展指定 directives，不放宽默认安全策略 |
| 缓存隔离修复 | 优先评估独立插件可行性 | 需进一步审计缓存插件可用 Hook | 上游缓存插件保持原样；如果没有足够 Hook 保证待审核评论 Cookie 绕过共享缓存，则不能声称安全修复已实现，需明确记录限制 |
| 缓存插件停用后的 KV 读写行为 | 上游缓存插件边界 | 插件生命周期/缓存 provider | 旧项目差异不能证明此问题已解决；单独测试停用、重启、重新启用、无控制配置时的读写行为 |

## 已确认的上游接口

- `route:request` 接收初始结果对象及请求上下文（包含 `request`、`url`、`path`、`db`、`options`、`env`、`pluginCtx`）。插件返回 `{ handled: true, response }` 可处理自定义路由。
- `registerPluginAdminPath('/api/admin/…')` 可登记插件自己的管理 API 路径。
- `comment:list` 在评论列表 API 的 metadata-only 和完整列表两条响应路径均可扩展 payload；Hook 上下文包含 `request`、`options`、`cid`。
- 原版 `requireAdminAction` 提供登录身份、权限、同源校验和 CSRF 校验；专属伴随插件应复用该机制，不自行发明鉴权。
- 插件 loader 从 workspace/node_modules 中发现包含 `typecho` 与 `plugin` keywords 的包；主题 loader 从 node_modules 发现包含 `typecho` 与 `theme` keywords 的包。根依赖登记是发现主题的必要步骤。
- 主题模板收到的基线 props 不含旧项目新增的 `csrfToken`；不得假定该字段存在。

## 已发现的迁移阻塞点

旧 Warm CY 主题目前直接导入若干核心内部模块，例如 `@/lib/context`、`@/lib/image-transform`、`@/lib/theme`、`@/lib/content`。这些不是全部都属于公开主题 SDK。迁移时应优先使用 `typecho/plugin-sdk`、`typecho/db` 和现有插件包导出；纯主题逻辑则在主题包内重写/封装，不能为迁移而改核心源码。

旧评论管理 UI 使用了旧版评论 API 提供的管理信息和 CSRF 字段，而基线 `ThemePostProps` 没有旧项目增加的 `csrfToken`。必须由专属伴随插件通过 `comment:list` 安全提供必要字段，并由管理 API 独立验证权限/CSRF；不能依赖旧核心新增字段。

## 当前状态

- 已完成：上游扩展点和主题/插件发现机制的源码核对；旧项目差异文件清单。
- 未完成：主题组件逐项适配、伴随插件实现、公共插件实现、构建与单测。
- 当前测试分支尚未包含迁移代码；不得将本文件视为完成证明。
