# Warm CY 与跨主题功能迁移矩阵

本表以旧项目 `1f5bc6ce25bc99f0d9f52942c426c9652da168ea` 相对上游基线 `6f268808f4f510852887f18cf43fd88567d69e15` 的 45 个提交、52 个文件差异为核对范围。此阶段是源码审计与迁移跟踪记录，不代表功能已全部迁移或测试通过。

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

旧 Warm CY 主题目前直接导入多个核心内部模块。逐文件核对确认：

- `typecho/plugin-sdk` 已公开 `buildPermalink`、`formatDate`、`buildCategoryLink`、`escapeHtml`、`renderContentExcerpt` 等通用能力；这些调用应优先迁移到 SDK，避免主题重复实现。
- `typecho/db` 是根包明确公开的数据库入口。
- `@/lib/theme-props` 的 `ThemeIndexProps`、`ThemePostProps`、`ThemePageProps`、`ThemeArchiveProps` 尚未通过根包 exports 或 plugin SDK 公开。当前不能擅自替换类型来源；需要将主题契约作为正式公开 API 的方案单独评估，且不得修改核心文件来迁就主题。
- `@/lib/context` 的 `createContext`、`@/lib/image-transform` 的图片优化实现、`@/lib/cache` 的 `PUBLIC_HTML_HEADER` 都是核心内部运行时能力。尤其 Context 会连接请求身份、插件上下文和数据库，不能简单复制到主题包；图片优化只有在确认完整行为和边界后才能封装；公开 HTML 缓存标记必须保留上游语义，不能由主题随意替代。
- `@/lib/content` 与 `@/lib/markdown` 中已有 SDK 对应导出，适合先改用公开 SDK。

伴随插件 `typecho-plugin-warm-cy` 已使用公开的 `typecho/db`、`typecho/plugin-sdk`，但同时直接导入 `@/lib/auth`、`@/lib/admin-auth`、`@/lib/options`。其中 `requireAdminAction` 当前确实完成登录身份、管理员权限、同源和 CSRF 校验，评论 metadata 路径则明确使用 `csrf: false` 只读取管理员身份并生成专用 token；但这些 helper 并未由公开 SDK 导出。因此它目前是与宿主源码耦合的本地伴随插件，不应宣称为可直接分发到任意 Typecho Workers 站点的独立公共插件。不能为了消除内部 import 而自行重写鉴权；应先确认上游公开扩展点，或保留本地耦合并在文档中标明边界。

旧评论管理 UI 使用旧版评论 API 提供的管理信息和 CSRF 字段，而基线 `ThemePostProps` 没有旧项目新增的 `csrfToken`。当前伴随插件通过 `comment:list` 在管理员身份验证成功后才附加 `management` 信息；匿名/普通访客不获得该字段。写操作通过管理员 API 再次验证权限和 CSRF。该机制需要补齐 metadata-only 与完整列表两条路径的测试，不能依赖旧核心新增字段。

## 当前状态（2026-11-03）

- 已有代码：测试分支已新增 Warm CY 主题包及其伴随插件，主题组件、样式、配置清单和部分管理 API 已提交。
- 已完成审计：上游插件 SDK 导出、Theme props、主题/插件自动发现机制已核对；确认 SDK 有一批可替代的通用函数，但 Theme props、请求 Context、图片优化、缓存响应标记和管理员鉴权 helper 仍属于内部接口；伴随插件存在明确的宿主源码耦合。旧项目差异文件清单已整理。
- 正在核对：将主题中的通用 helper 调用迁至公开 SDK；厘清不能迁出的 Context/缓存/鉴权边界；补足伴随插件的权限与评论 metadata 回归测试；旧功能逐项迁移完整性。
- 尚未完成：全部功能验收、公共插件迁移、逐文件核心 blob 校验、构建与单元测试。
- 本文档是迁移跟踪记录，不是功能完成或可部署证明；未通过验证前不得合并或部署。
