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
- `@/lib/theme-props` 的 `ThemeIndexProps`、`ThemePostProps`、`ThemePageProps`、`ThemeArchiveProps` 尚未通过根包 exports 或 plugin SDK 公开。Warm CY 仍保留这些类型依赖；当前不能擅自复制一套类型或替换类型来源，需要单独评估公开主题契约方案，且不得修改核心文件来迁就主题。
- `@/lib/context` 的 `createContext` 是核心内部请求上下文能力，连接请求身份、插件上下文和数据库。当前 Warm CY 首页和文章页已移除 `createContext` 调用，Notes 查询改用页面已有数据库连接；其他场景仍需逐项核对，不能复制 Context 实现。
- Warm CY 的图片 URL 优化和内容图片尺寸恢复逻辑已收回主题包 `components/warm-image.ts`，首页、文章页、独立页、笔记媒体和主题设置 helper 改用主题本地函数。该迁移仅覆盖主题自己的 EdgeOne URL 改写，不替代核心 `image-transform` 的通用图片能力。
- Warm CY 的主题配置读取已从核心 `loadThemeConfig` 改为主题内读取 `theme:<id>` 保存值并合并主题默认配置；目录锚点 slug 生成也已改为主题本地实现。核心 `@/lib/theme-props` 类型依赖仍保留。
- `@/lib/cache` 的 `PUBLIC_HTML_HEADER` 是核心缓存标记，必须保留上游语义，不能由主题随意替代。
- `@/lib/content` 与 `@/lib/markdown` 中已有 SDK 对应导出，通用 helper 应优先改用公开 SDK。

伴随插件 `typecho-plugin-warm-cy` 已使用公开的 `typecho/db`、`typecho/plugin-sdk`，但同时直接导入 `@/lib/auth`、`@/lib/admin-auth`、`@/lib/options`。其中 `requireAdminAction` 当前确实完成登录身份、管理员权限、同源和 CSRF 校验，评论 metadata 路径则明确使用 `csrf: false` 只读取管理员身份并生成专用 token；但这些 helper 并未由公开 SDK 导出。因此它目前是与宿主源码耦合的本地伴随插件，不应宣称为可直接分发到任意 Typecho Workers 站点的独立公共插件。不能为了消除内部 import 而自行重写鉴权；应先确认上游公开扩展点，或保留本地耦合并在文档中标明边界。

旧评论管理 UI 使用旧版评论 API 提供的管理信息和 CSRF 字段，而基线 `ThemePostProps` 没有旧项目新增的 `csrfToken`。当前伴随插件通过 `comment:list` 在管理员身份验证成功后才附加 `management` 信息；匿名/普通访客不获得该字段。写操作通过管理员 API 再次验证权限和 CSRF。该机制需要补齐 metadata-only 与完整列表两条路径的测试，不能依赖旧核心新增字段。

## 当前状态（2026-11-03）

- 已有代码：测试分支已新增 Warm CY 主题包及其伴随插件，主题组件、样式、配置清单和部分管理 API 已提交。
- 已完成审计：上游插件 SDK 导出、Theme props、主题/插件自动发现机制已核对；旧项目差异文件清单已整理；核心文件与固定基线的 Blob SHA 已逐项核验，当前对照文件一致，未修改核心文件。
- 已完成的主题解耦：`Index.astro`、`Post.astro` 已移除 `createContext`；图片 URL/内容图片 helper 已移入主题；`warm.ts` 已移除核心 `loadThemeConfig` 和 `generateSlug` 依赖，改为主题本地配置合并与 slug 生成。`typecho/plugin-sdk` 仍用于公开的格式化和 HTML escaping helper。
- 仍保留的内部类型依赖：`@/lib/theme-props`，因为固定基线没有公开等价类型契约；不自行复制类型、不改核心文件。
- 正在核对：剩余主题组件对核心内部接口的依赖；伴随插件鉴权和评论 metadata 的安全边界；Markdown 增强与拼音别名的 Hook 覆盖范围；旧功能逐项迁移完整性。
- 尚未完成：全部功能验收、公共插件迁移、逐文件核心 blob 校验、构建与单元测试。
- 本文档是迁移跟踪记录，不是功能完成或可部署证明；未通过验证前不得合并或部署。

## 本轮补充审计（2026-11-03）

### 核心依赖处理结论

- WarmShell.astro 的 PUBLIC_HTML_HEADER 必须保留。固定基线中的 src/middleware.ts 会设置并检查该标记，src/plugins/typecho-plugin-cache/cache.ts 会消费它来判定响应是否属于可缓存的公共 HTML。主题自行更换或删除该标记会改变缓存语义。
- ThemeBaseProps、ThemeIndexProps、ThemePostProps、ThemePageProps、ThemeArchiveProps 是宿主页面路由与主题组件之间的数据契约。当前固定基线没有从 typecho/plugin-sdk 公开导出这些类型。它们是 import type，不会形成运行时模块依赖；在不修改核心、不复制第二套契约的约束下，当前保留类型导入比自行定义重复接口更安全。
- PageContext 同样是 Base.astro / 插件客户端片段之间的宿主契约；保留类型导入，不复制定义。
- 上述保留项是有意的宿主类型/协议依赖，不等于修改或分叉核心文件。核心文件仍以固定基线 Blob SHA 为准。

### 图片 helper 回归用例

- Warm CY 图片优化 helper 已在主题目录内实现，并增加 warm-image.test.ts。
- 新 helper 在追加优化参数时会把 query 放在 URL fragment 之前，保留 #width=...&height=... 尺寸信息；已有 HTML width/height 属性优先；GIF、SVG、外站 URL 和非 /usr/uploads/ 路径不重写。
- 测试文件被 Vitest 默认的 src/**/*.test.ts 模式覆盖，但尚未在当前环境实际执行。不能标记为测试通过。

### Markdown 增强的插件化边界

- 固定基线的 renderMarkdownFiltered() 先调用 content:markdown，再由核心 Marked 解析并执行 sanitize-html，最后调用 content:content。因此：
  - content:markdown 适合将 Mermaid / 数学公式转换为标准代码块等可被原版解析器识别的标记；
  - content:content 发生在核心 sanitizer 之后，插件若在此直接插入任意 HTML，会绕过核心 sanitizer，不得把它当作放宽 HTML 白名单的安全替代方案；
  - 客户端资源可通过插件自身的 client/*.ts 文件构建，并通过 archive:header / archive:footer 注入本地资源引用。
- Notes 插件的笔记正文当前使用公开 SDK 的同步 renderMarkdown()，不经过 renderMarkdownFiltered()。因此只挂接 content:markdown 的插件不会自动覆盖笔记正文；必须另行确认可用的 Notes 扩展点，不能声称一次 Hook 就覆盖文章、页面、笔记、评论、RSS 和后台预览。
- 评论 Markdown 使用独立的 comment:markdown / 评论渲染路径，不应默认启用文章 HTML/SVG 白名单。评论内容继续使用较严格的独立 sanitizer。
- 旧 feature/markdown-full-support 分支的完整改动涉及核心 src/lib/markdown.ts、src/lib/plugin.ts、src/lib/theme-props.ts、后台页面和 API 等文件；不能 cherry-pick 或合并整条分支到本迁移分支。应只挑选可通过插件 hook 和插件 client asset 实现的功能，核心 Markdown sanitizer 与安全边界保持固定基线原样。

### 当前工作状态修正

- 已提交图片 helper 与回归测试，但尚未运行 Vitest 或 Astro build。
- 已确认缓存标记和宿主 Props / PageContext 类型依赖应保留；本轮没有修改这些核心接口。
- 尚未实现独立 Markdown 插件。数学公式、Mermaid、PrismJS 的插件方案仍需逐项验证文章/页面/笔记/评论/预览覆盖范围，以及依赖与 CSS/字体资源的构建方式。
- 当前 GitHub 测试分支没有配置 Actions workflow；此前不能把无 CI 记录解释为构建通过。需要在本地/可执行构建环境运行测试，或在后续专门建立受控 CI 后再验收。

### 拼音别名插件 Hook 覆盖核验

- 固定基线的内容保存 API 在调用 post:write / page:write filter 后，仍会根据“用户提交的 slug”或核心 generateSlug(title) 计算最终 slug，并通过 claimUniqueSlug() 覆盖数据库 slug。也就是说，post:write / page:write 当前不能可靠地改变自动生成 slug；插件只在 Hook 中写 contentData.slug 会被后续最终 slug 逻辑覆盖。
- 这意味着纯服务端拼音别名插件不能只依赖 post:write / page:write。不能提交一个表面可用、实际保存后又被覆盖的插件。
- 可行方向需进一步验证：在后台编辑器使用插件的 admin:writePost:bottom / admin:writePage:bottom 注入客户端拼音输入辅助；只在 slug 输入为空或仍处于插件自动生成状态时更新，用户手动编辑后立即停止覆盖；保存时通过现有表单提交显式 slug。必须确认 permalink 不含 {slug} 时 UI 不存在 slug 字段的降级行为，并确保编辑旧文章时不覆盖现有 slug。
- 若要求无浏览器脚本的 API、批量导入、自动化写入也统一生成拼音，则固定基线没有足够的公开 Hook；在“不修改核心”的前提下无法保证全路径一致，需明确标记能力边界，而不是暗中复制核心保存流程。

### Warm CY 主题 helper 回归测试补充

- 新增 components/warm.test.ts，覆盖置顶 ID 解析、加载模式归一化、外链 URL 安全处理、邮箱校验、主题设置读取与默认值、目录标题 ID 去重、摘要清理和阅读时长计算。
- 测试与 warm-image.test.ts 一样由现有 Vitest include 规则发现。
- 当前 GitHub 工具只能提交和读取仓库文件，尚未在项目运行环境安装依赖并执行 Vitest / Astro build；这些用例状态为“已编写、未执行”，不能标记为通过。
- 主题设置默认值与 theme.json 的 config.default 已逐项对照，当前 helper 默认值保持一致；历史保存的 commentInitialLoadMode=dwell 兼容逻辑也有测试覆盖。

### Warm CY 伴随插件权限回归测试

- 新增 src/plugins/typecho-plugin-warm-cy/index.test.ts，沿用仓库现有插件单元测试模式，通过 mock 管理员鉴权、CSRF token 和设置写入接口测试插件 Hook。
- 覆盖路由注册、非 POST 拒绝、无关路由透传、未登录拒绝、主题未启用拒绝、置顶设置保留其他主题选项、匿名评论不返回管理元数据、管理员评论元数据包含专用 CSRF token，以及无 authCode / 无内容行时不返回管理元数据。
- 这些测试尚未执行。特别是管理员操作路由依赖宿主 requireAdminAction 的真实鉴权与同源/CSRF 检查；插件测试通过 mock 验证的是“正确调用鉴权门”，不是替代宿主鉴权集成测试。

### 拼音插件与首次 CI 验证（2026-11-03）

- 新增独立工作区插件 `typecho-plugin-pinyin`，只依赖编辑器底部 Hook 和专用管理员 API，不修改内容保存 API、编辑器源码、数据库或主题。
- 文章与独立页面分别读取 `permalinkPattern` / `pagePattern`；只有包含 `{slug}` 才注入辅助功能。编辑旧内容时保留现有 slug；新建内容只在 slug 为空时自动建议；手动编辑后停止覆盖，允许用户主动重新生成。
- 拼音转换由 Worker 端执行，使用本地 `pinyin-pro` 依赖；显式设置 `nonZh: 'consecutive'`，避免英文单词被逐字母拆开。
- API 仅接受 POST，复用 `requireAdminAction(request, 'editor')`，其默认开启同源与 CSRF 检查。响应使用 `private, no-store`。
- 根 workspace、插件 workspace、`bun.lock` 和 `astro.config.mjs` 的依赖预打包排除清单均已登记。
- 新增独立的分支验证工作流，仅执行冻结锁文件安装、Vitest 和 Astro build；不包含 Cloudflare deploy 步骤。
- 成功运行：GitHub Actions run `41623551813`。`bun install --frozen-lockfile` 成功；129 个测试文件、1503 项测试全部通过；`astro build` 成功，日志显示 8 个插件和 2 个主题被打包。
- CI 首轮暴露的拼音英文分词、Warm CY iframe 属性连续覆盖、TOC slug 测试预期，以及 HyperDown UMD 在 ESM 测试环境中的加载问题均已修复后复测通过。
- 当前分支相对固定基线 `6f268808f4f510852887f18cf43fd88567d69e15` 仍为 ahead 48 / behind 0。逐个比较核心目录与文件的 Blob SHA：基线 158 个、当前 158 个，差异 0。
- 本次 CI 是单元测试和 Astro 构建验证，不是 `build:cloudflare`、Wrangler 部署验证或线上功能验收；尚未合并主分支，也未部署。


### 最新复核与插件验证（2026-11-03，CI run 41629790555）

- 最新分支 HEAD：\`01ec8a3ad034d0b0a52d3ed36bb88cedf7057680\`。
- 最新 GitHub Actions：依赖安装成功；130 个测试文件、1508 项测试全部通过；Astro build 成功。该验证不包含 Wrangler 部署或线上浏览器验收。
- Markdown 增强插件 \`typecho-plugin-markdown\` 已加入 workspace，包含数学公式、Mermaid 和 Prism 代码高亮客户端入口。文章/页面公式语法通过 \`content:markdown\` 转为普通 Markdown code span / fenced code block，不注入 HTML、不修改 sanitizer。
- 数学公式支持 \`$...$\`、\`\\(...\\)\`、\`$$...$$\` 和 \`\\[...\\]\`；已补充行内代码保护、美元符号、单行/多行公式及方括号块公式测试。KaTeX 输出原生 MathML，使用 \`trust: false\`，并由本站 DOMPurify 清理。
- CI 日志确认 Markdown 的 4 个 JS 客户端入口（loader、math、Mermaid、highlighter）均由现有 client-loader 打包。尚未完成真实浏览器页面验收；不据此宣称所有主题、Notes 页面和编辑器预览都已端到端验证。
- 拼音别名插件 \`typecho-plugin-pinyin\` 已独立实现并登记 workspace 与锁文件。只在永久链接包含 \`{slug}\` 时注入；新建且 slug 为空时自动建议；已有文章不自动覆盖；用户手动修改后停止覆盖；通过显式按钮可重新生成。转换在 Worker 本地依赖中完成，不使用第三方 CDN。
- 拼音插件专用 API 只接受 POST，复用 \`requireAdminAction(request, 'editor')\` 的现有权限、同源和 CSRF 校验；最终 slug 仍由原有表单提交和上游唯一性逻辑保存。该能力限后台编辑器路径，不能覆盖绕过浏览器编辑器的导入/API 写入路径。
- 固定核心基线 \`6f268808f4f510852887f18cf43fd88567d69e15\` 与当前分支再次逐个 Blob SHA 比较：158 个核心文件对 158 个，差异 0。
- 当前仍未完成：真实站点/浏览器验收、Warm CY 全部主题功能逐项验收、缓存边界复测、完整迁移清单收尾。没有合并主分支，没有部署正式站点。

### 提示块与缓存停用行为复核（2026-11-03）

- GitHub 风格提示块并非完全缺失：固定上游 markdown-alerts.ts 已实现 [!LABEL] 解析、NOTE/TIP/WARNING 样式 class 和 HTML label 转义；Warm CY 样式已覆盖 NOTE、TIP、IMPORTANT、WARNING、CAUTION 五类配色。
- 旧项目相对固定基线对 markdown-alerts.ts 的差异包括连续合并 blockquote 的段落归属处理，以及 NOTE/TIP/IMPORTANT/WARNING/CAUTION 的内联 SVG 图标。不能把旧版整份 helper 复制进核心；当前仅在 Warm CY 样式层增加标题伪元素图标，不改变 sanitizer、Markdown HTML 或核心文件。该视觉微调需要真实浏览器验收。
- typecho-plugin-cache 停用路径已检查：early-request provider 的 deactivate lifecycle 删除 KV control document、清空 control/generation memo、将 runtimeConfig 置空，并尝试清除平台缓存 tag；后续 sync(active:false) 将请求 runtime 标记为 null。现有 index.test.ts 的停用测试覆盖停用后请求不添加缓存响应头、不重建 control document。
- 重新启用路径有对应测试：activated sync 后若 KV control document 缺失，首次请求可从已同步的 runtime config 重建 control document。这里测试的是缓存控制状态恢复，不代表所有 KV/D1 业务数据都在停用时删除；页面缓存条目可能仍留在 KV，是否读取取决于控制文档和 runtime active 状态。
- 当前 CI run 41631020504（HEAD 8f6fcca6）已通过：130 个测试文件、1508 项测试；Astro build；Markdown 插件 4 个 JS 入口打包；CI 明确检查 Markdown 资源文件存在。此验证不含线上浏览器验收或 Wrangler 部署。
- Warm CY 标题图标 CSS 修正提交 bb1339492629f34fa54d5aeb61eadb966eadd84d 正在独立 CI 验证；在结果返回前不标记为通过。
### 旧版后台主题设置与核心小改动归属复核

- 旧项目 options-theme.astro 的 600 余行改动主要是 Warm CY 专属表单排版：置顶 ID、十组页脚链接、图片参数、加载模式和页脚自定义 HTML 的分组与交互。当前 Warm CY theme.json 已声明这些设置字段，原版 options-theme.astro 可按通用 schema 展示并保存；因此核心后台页面保持固定上游，不恢复针对单一主题的条件分支。当前保留字段和功能，旧版分组/动态显示属于未复刻的管理界面体验差异。
- 如果后续确实需要完全恢复旧版表单布局，应优先评估 Warm CY 伴随插件在主题启用时对后台主题设置页做局部增强；不得把旧 options-theme.astro 整份改动带回核心。
- 旧项目对 public/css/admin.css 的单行修改只为移动端后台导航增加 min-height；该文件属于宿主后台资源，本迁移阶段不改核心资源，先不迁移这一视觉微调。
- 旧项目给 src/lib/page-data.ts 增加 csrfToken、给 src/pages/admin/index.astro 增加项目宣传文字的差异均未恢复：前者由 Warm CY 伴随插件在管理员评论 metadata 路径提供专用 token，不扩展核心 Theme props；后者是项目品牌文案，不属于主题功能。
### Warm CY 页面导航高亮修正（2026-11-03）

- 原主题导航使用 page.permalink.includes(currentPath)，相似路径可能错误高亮（例如 /about-me/ 误匹配 /about/）。已在主题 helper 中新增 isCurrentPageLink：使用 URL 解析、限制同源，并按去除尾部斜杠后的 pathname 精确匹配；WarmShell 页面导航使用该 helper。
- 新增 warm.test.ts 测试，覆盖尾斜杠等价、相似路径不匹配和跨域地址不匹配。仅修改 Warm CY 主题文件与测试，不修改核心。
- 最新验证提交 545dff56df72b400ecc577196214caa3f61a0d57 的 GitHub Actions run 41633346528 成功：130 个测试文件、1509 项测试全部通过；Astro build 成功；Markdown 插件 4 个客户端入口资源检查通过。
- 同一提交对固定上游基线逐个 Blob SHA 比较：158 个核心文件与基线一致，差异 0。CI 仍不等于 Wrangler 部署或真实浏览器验收。
### 主题设置映射与拼音接口边界复核（2026-11-03）

- 已逐项比对 Warm CY theme.json 的 37 个配置键与主题实现：置顶、10 组页脚链接、自定义页脚 HTML、图片/缩略图优化、列表加载、评论组件加载和评论列表加载均有对应读取与渲染路径。页脚链接键由 warm.ts 按编号动态读取，因此不能只用静态字符串搜索判断未使用。
- 首页置顶只在首页第一页插入；先按 ID 查询仍处于 publish 状态且发布时间不晚于当前时间的文章，再按配置顺序展示，并从普通列表中排除这些 ID，避免分页重复。
- 拼音插件接口增加非空标题校验，并补充 malformed JSON、空白标题和超过 500 字符标题的测试；编辑器端手动修改保护、异步响应过期保护及重新生成按钮均已检查。
- 最新提交 b6d393f37af28929a7a3f369bed5536bc14480bf 的 CI run 41634463987 成功：130 个测试文件、1510 项测试通过；Astro build 成功；Markdown 插件 4 个客户端入口资源检查通过。
- 本次改动仍未触碰核心。固定基线对照 158 个核心文件逐个 Blob SHA 检查，差异 0。以上 CI 不包含 Wrangler 部署或真实浏览器端交互验收。

## 本轮补充审计（2026-11-06）：内容 Hook 请求上下文隔离边界

### 已核实的上游调用链

- `src/lib/context.ts` 的 `buildContext()` 为每个请求创建独立 `RequestContext`，并在请求生命周期中触发 `system:begin`，该 Hook 收到当前 context。
- 但固定上游 `src/lib/markdown.ts` 的 `renderMarkdownFiltered(ctx, text)` 调用 `applyFilter(ctx, 'content:markdown', content)` 与 `applyFilter(ctx, 'content:content', sanitized)` 时，只传入内容值，没有把当前 context 作为额外参数传给过滤器。
- `applyFilter()` 本身支持额外参数，但调用方没有传递；因此插件回调声明第二个参数并不能获得请求 options。文章和页面的 `content` 在主题组件接收 Props 之前已经由上游渲染，主题组件无法在当前链路中补传原始 Markdown 和请求 context。
- `renderMarkdownFiltered()` 的缓存键当前只包含源文本与已启用插件 ID，不包含插件设置快照。任何未来的请求级内容过滤都必须同时评估缓存键，不能只增加 Hook 参数而忽略缓存串用。

### 当前插件实现的风险与结论

- Warm CY 伴随插件当前在 `system:begin` 中把 theme 与插件设置写入模块级 `activeCyPluginSettings`，之后由内容过滤器读取。
- 这不是可靠的请求级隔离：请求 A 的 `system:begin` 与其 Markdown 过滤之间可能被请求 B 的 `system:begin` 插入，A 随后会读到 B 的快照。单线程事件循环并不能消除异步请求交错。
- 该配置目前是站点级选项，正常情况下各请求值相同；但设置更新、主题切换或不同请求快照交错时，仍不能保证按请求读取。现有测试验证了 Hook 可读取一次 `system:begin` 快照，没有验证并发交错隔离。
- 在“不修改任何上游核心文件”的约束下，当前已确认的公开插件 Hook 没有把请求 context 传给 Markdown 过滤器的途径。不能用模块级变量、定时清理或单线程假设伪装成已解决。
- 因此此项保留为明确的未解决风险，不把当前模块级快照方案标记为并发安全，也不擅自修改核心。

### 若将来允许调整上游接口，最小方案

1. 由上游 `renderMarkdownFiltered()` 在调用两个内容过滤器时，将当前请求 context 作为显式额外参数传入。
2. 插件只从该参数读取当前请求的 `options`，移除 `activeCyPluginSettings` 与 `system:begin` 模块级快照。
3. 审查并调整 Markdown 渲染缓存键，使会影响输出的插件设置纳入键值，或确保每次相关设置写入都可靠清空对应缓存。
4. 增加 A/B 两个请求交错执行的回归测试，证明 A 的设置不会影响 B，反之亦然。
5. 以上涉及上游核心接口；在用户明确放宽核心文件保护原则之前，不实施。

### 主题与插件职责复核

- 主题保留页面结构、导航/搜索对话框的 DOM、文章目录、置顶文章展示、评论组件 UI、图片呈现、笔记媒体、分页与加载交互。这些都依赖主题布局或页面 Props，属于主题呈现职责。
- 伴随插件保留正文 HTML 保护/恢复、安全过滤、视频 iframe 接管及播放器运行时、Markdown Alert 图标样式设置、全局搜索运行时、管理 API、评论管理权限元数据和插件设置页。这些是可独立开关或需要宿主 Hook/权限的增强行为。
- 评论管理按钮的实际 HTML 由主题 `WarmComments.astro` 渲染；插件通过 `comment:list` 验证管理员并提供 `management` metadata/CSRF token。UI 留在主题、权限与元数据留在插件的边界是合理的，不应把主题组件整体搬入插件。
- `WarmShell.astro` 保留搜索对话框和触发按钮；插件的 `globalSearchRuntime()` 负责增强其搜索交互。DOM/视觉属于主题，跨页面运行时行为属于插件。
- `warm.ts` 中的置顶 ID、页脚链接、图片参数、连续加载和评论加载模式读取属于主题设置与呈现；插件设置中的搜索按钮、评论管理、HTML 增强、Alert 样式和视频开关由伴随插件控制。主题读取少量插件开关用于决定是否渲染 UI，不等于插件行为被错误地复制进主题。
- 伴随插件仍直接依赖宿主内部的 `@/lib/auth`、`@/lib/admin-auth`、`@/lib/options`，因此它是当前仓库的本地宿主伴随插件，不是可直接安装到任意 Typecho Workers 实例的通用公共插件。不得自行复制鉴权实现来消除这项依赖。
