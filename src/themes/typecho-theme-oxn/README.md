# OXN Simple 主题说明

> 本文对应仓库分支 `25` 中的 `src/themes/typecho-theme-oxn/`。  
> OXN 是基于 Typecho Warm 主题开发的定制主题：保留 Warm 的基础页面结构与阅读体验，并在此基础上持续开发 OXN 自有的设置界面、前台功能、交互和样式。本文详细说明当前版本的主题定位、后台设置、字段规则、前台行为、与 Warm 原版的差异，以及文章内容输入语法。

---

## 1. 主题定位与来源

- **主题 ID：** `typecho-theme-oxn`
- **主题名称：** Oxn Simple
- **原版来源：** `src/themes/typecho-theme-warm/`（对照分支 `1119d`）
- **OXN 目录：** `src/themes/typecho-theme-oxn/`（维护分支 `25`）
- **主要文件：**
  - `theme.json`：主题元数据、后台设置项及自定义设置界面。
  - `style.css`：主题布局、文章排版、响应式样式、亮色和暗色主题。
  - `components/Index.astro`：首页、文章列表、笔记流和置顶文章。
  - `components/Post.astro`：文章、密码文章、笔记详情及文章声明。
  - `components/Page.astro`：独立页面。
  - `components/WarmShell.astro`：全站外壳、导航、快捷按键、页脚、搜索弹窗和主题切换。
  - `components/WarmComments.astro`、`WarmCommentList.astro`：评论组件、评论列表和管理操作。
  - `components/WarmNoteMedia.astro`：笔记图片、视频、音频和附件。
  - `components/WarmStreamPagination.astro`：列表分页及后续内容加载。
  - `components/warm.ts`：主题设置读取、图片参数转换、置顶 ID 解析、目录生成和声明变量替换。
  - `components/octicons.ts`：Octicons 图标目录读取、图标名称解析及导航/页脚图标输入渲染。
  - `ICONS-LICENSE.md`：中英双语图标使用与授权说明；`OCTICONS-LICENSE.txt`：Octicons 上游 MIT 许可证文本。
  - `components/instantclick.ts`、`viewimage.ts`：页面切换与图片查看相关脚本。
  - `assets/favicon.svg`、`assets/favicon.ico`：OXN 页面使用的站点图标；`assets/screenshot.png`：后台主题预览截图。

OXN 保留 Warm 的单栏、简洁阅读方向和主要页面结构，但后台设置、快捷操作、笔记列表兼容、置顶、管理交互、表单、弹窗、暗色配色及部分内容展示已经按 OXN 的需求进行了定制。它不是与原版完全相同的主题副本。

## 2. 为什么需要一处核心路由兼容修改

### 2.1 原因

主题组件只能在核心路由完成页面类型判断、准备好页面数据后运行。首页入口 `src/pages/index.astro` 会先判断当前主题、读取文章列表，并在没有普通文章数据时决定是否直接返回 404。

笔记插件的某些入口可能只有笔记或话题结果，没有普通文章列表。如果核心路由提前按“没有文章”返回 404，OXN 的 `Index.astro` 根本没有机会执行，单靠主题组件内部无法补救。

### 2.2 当前采用的最小兼容方式

核心入口对 OXN 做了明确识别：当当前主题为 `typecho-theme-oxn`、笔记插件已启用，并且访问的是笔记/话题流入口时，允许空的普通文章列表继续进入主题组件。

这处修改的目的仅是**让 OXN 的笔记流有机会完成自己的数据读取和渲染**，不是把笔记业务搬进核心，也不是修改数据库结构或改变所有主题的空列表规则。

对应位置：

- 核心入口：`src/pages/index.astro`
- OXN 笔记流：`src/themes/typecho-theme-oxn/components/Index.astro`

### 2.3 为什么不把这段逻辑写进主题

因为核心路由的 404 判断发生在主题模板执行之前。主题无法拦截一个尚未被交给主题的请求，所以必须在路由层增加这个很小的主题兼容条件。

除此之外，OXN 的布局、排版、弹窗、密码表单、置顶展示、页脚、图片显示等主题表现，优先在 OXN 目录内实现。不要为了调整主题外观或主题交互而随意修改 Typecho 核心文件。

> 注意：Markdown 转换和文章 HTML 清理仍属于项目共享内容处理流程，不是 OXN 自己重新实现的一套 Markdown 引擎。OXN 使用处理后的文章 HTML，并在主题内部完成排版和展示。

### 2.4 使用 OXN 时必须同步的文件

如果要在另一个 Cloudflare 环境中使用当前 `25` 版本，不能只替换主题目录。OXN 有部分功能依赖项目共享核心文件；这些核心文件仍使用上游原版时，对应功能会缺失或被安全策略拦截。

#### 必须同步的主题与核心文件

| 类型 | 路径 | 必须同步的原因 |
| --- | --- | --- |
| OXN 主题 | `src/themes/typecho-theme-oxn/` | OXN 的主题组件、样式、设置界面和前台功能；替换整个目录 |
| 核心路由 | `src/pages/index.astro` | 增加 OXN 笔记/话题流入口兼容，避免核心路由在主题组件运行前因普通文章列表为空而提前返回 404 |
| OXN 置顶 API | `src/pages/api/admin/theme-pin.ts` | 为评论区管理员置顶/取消置顶提供独立 POST 接口；负责管理员身份与 CSRF 校验、文章有效性检查、OXN 配置写入及数据库读回核验 |
| Markdown/HTML 处理 | `src/lib/markdown.ts` | 扩展文章、独立页面和笔记正文的 HTML/SVG 标签、属性及受限内联样式白名单；增加 iframe 主机白名单和图片尺寸参数处理 |
| CSP 安全策略 | `src/lib/security-headers.ts` | 默认 CSP 的 `frame-src` 必须与 Markdown iframe 主机白名单对应；包含 Bilibili 页面域名和播放器域名，否则 iframe 即使通过 Markdown 清理也会被浏览器拦截 |
| 构建配置 | `astro.config.mjs` | 同步当前分支的 Vite workspace 依赖优化配置，避免继续使用上游已不匹配的工作区排除项 |
| 依赖清单 | `package.json` | 声明当前分支使用的 OXN 主题及插件 workspace 依赖 |
| 依赖锁定文件 | `bun.lock` | 与当前 workspace 依赖清单保持一致，确保安装和构建解析到对应版本 |

#### 按需同步的插件目录

| 类型 | 路径 | 说明 |
| --- | --- | --- |
| 拼音插件 | `src/plugins/typecho-plugin-pinyin/` | 需要拼音转换、编辑器拼音功能时，替换整个目录；这是插件功能，不是 OXN 主题本身的必需组件 |

以上核心文件应从同一维护版本同步，不能只挑选主题目录。若仍使用上游的 `src/pages/index.astro`、`src/lib/markdown.ts` 或 `src/lib/security-headers.ts`，OXN 的笔记流入口、扩展内容格式和第三方 iframe 嵌入可能无法完整工作。

#### API 目录历史核对（分支 22 → 24）

对比仓库分支 `22` 与当前分支 `24` 的 `src/pages/api/` 文件树后，**本次 API 目录唯一新增的文件是**：

- `src/pages/api/admin/theme-pin.ts`：OXN 评论区管理员置顶/取消置顶接口。

其余 API 文件和子目录在分支 `22` 中已经存在，不属于本次升级新增项。尤其是 `admin/passkey/`、`users/passkey/` 下的通行密钥接口，不应误记为本次新加文件。升级时应保留完整的 `src/pages/api/` 目录；不要因为本次只新增一个路由，就用单个文件覆盖整个目录。

当前 API 路由目录结构如下（用于核对文件是否缺失）：

```text
src/pages/api/
├── comment.ts
├── comments.ts
├── install.ts
├── admin/
│   ├── passkey/
│   │   ├── index.ts
│   │   ├── register-options.ts
│   │   └── register.ts
│   ├── comment-action.ts
│   ├── comment-batch.ts
│   ├── comment-edit.ts
│   ├── content-batch.ts
│   ├── content.ts
│   ├── editor-size.ts
│   ├── media-batch.ts
│   ├── media.ts
│   ├── meta.ts
│   ├── options.ts
│   ├── plugin-action.ts
│   ├── plugin-config.ts
│   ├── plugin.ts
│   ├── profile.ts
│   ├── tags-suggest.ts
│   ├── theme-config.ts
│   ├── theme-pin.ts       # 分支 24 新增
│   ├── theme.ts
│   ├── upload.ts
│   ├── user-batch.ts
│   └── user.ts
└── users/
    ├── passkey/
    │   ├── login-options.ts
    │   └── login.ts
    ├── forgot-password.ts
    ├── login.ts
    ├── logout.ts
    ├── register.ts
    └── reset-password.ts
```

上表中除 `admin/theme-pin.ts` 外，其余文件均为原有核心 API 路由；本次不修改它们的职责或实现。

#### 两套 iframe 白名单必须同时匹配

Bilibili iframe 需要经过两道独立检查：

1. `src/lib/markdown.ts` 的 `allowedIframeHostnames`：决定 Markdown/HTML 清理时是否保留 iframe 地址主机名。
2. `src/lib/security-headers.ts` 的 CSP `frame-src`：决定浏览器是否允许页面加载该 iframe。

当前维护版本在两处均允许 `www.bilibili.com` 和 `player.bilibili.com`。只配置其中一处是不够的：Markdown 放行但 CSP 未放行时，浏览器仍会阻止嵌入；CSP 放行但 Markdown 未放行时，iframe 会在输出前被清理。

#### 不需要为 OXN 功能替换的文件

当前 `24` 的 `scripts/generate-wrangler-config.ts` 和 `wrangler.toml.example` 与上游 `master` 内容一致，不属于 OXN 功能所需的差异文件。不要因为它们出现在历史比较结果中就额外覆盖。

`src/lib/markdown.ts.sim` 和 `src/lib/markdown.ts.bak` 仅用于对照和回查，不是部署文件；部署时只替换实际运行的 `src/lib/markdown.ts`。

#### 三个 markdown.ts 文件的用途与差异

当前分支保留了三个文件，便于追溯本次共享 Markdown 清理规则的变化：

| 文件 | 用途 | 当前核对结果 |
| --- | --- | --- |
| `src/lib/markdown.ts` | 当前实际参与项目运行的文件 | 已扩展 HTML/SVG 白名单、属性和受限内联样式规则，并增加图片 URL 尺寸参数解析 |
| `src/lib/markdown.ts.sim` | 修改前保存的对照副本 | 与 `.bak` 内容完全一致 |
| `src/lib/markdown.ts.bak` | 保存的上游原版对照文件 | 与 `.sim` 内容完全一致 |

在当前 `24` 分支中，`markdown.ts.sim` 和 `markdown.ts.bak` 的文件内容及 Git Blob SHA 相同（均为 `4ab2c30789c0032aa4ddce14a8af7abcaa6c7d77`），两份备份之间没有代码差异。它们均为 413 行；当前使用的 `markdown.ts` 为 547 行。

**关于笔记插件绑定：** 两份备份都已经包含 `applyFilter()`、`renderMarkdownFiltered()`，以及 `content:markdown`、`content:content` 两个过滤钩子。这套共享插件过滤机制在保存两份备份时就已存在，并非其中一份后来单独增加的内容。因此，不能把笔记绑定描述为 `.sim` 与 `.bak` 的差异。两份文件虽然来源记录不同（一个是当时项目文件的副本，一个是上游原版副本），但本次保存时的实际代码内容相同。

当前 `markdown.ts` 相比两份对照文件，主要增加或扩展了：

1. **HTML 标签白名单：** 增加常见结构标签、表单标签、图片容器标签，以及 SVG 图形、渐变、滤镜等标签。
2. **HTML 属性白名单：** 增加通用的 `class`、`id`、`title`、`style`、`role`、`aria-*`、`data-*` 属性，并扩展链接、媒体、表单和 SVG 元素各自允许的属性。
3. **内联 CSS 过滤：** 增加按 CSS 属性和正则规则检查的 `allowedStyles`；不是无条件放行所有属性或任意脚本，事件处理器属性仍不在允许范围内。
4. **SVG 标签解析：** 设置 `lowerCaseTags: false`，以兼容 SVG 中带大小写的标签名称。
5. **图片尺寸处理：** 从图片 URL 中读取有效的宽高参数，清理尺寸参数/fragment，并将有效尺寸写入最终 `img` 标签的 `width`、`height` 属性。

这些改动位于项目共享的 `src/lib/markdown.ts`，不是 OXN 主题内部单独运行的 Markdown 引擎。文章、独立页面和笔记正文会使用共享处理流程；评论 Markdown 仍使用单独且范围更窄的清理配置。

**部署时只替换当前使用的 `src/lib/markdown.ts`。** `.sim` 和 `.bak` 仅用于对照、回查和恢复，不需要复制到另一个 Cloudflare 环境。


### 2.5 从原版 Warm 切换到 OXN

OXN 与原版 Warm 是两个独立主题，主题 ID 分别为 `typecho-theme-oxn` 和 `typecho-theme-warm`。切换到 OXN 不需要删除原版 Warm，也不能把 OXN 文件覆盖到原版 Warm 目录中。

如果要在现有 Typecho-Workers 项目中启用当前维护版本的 OXN，按下面顺序处理：

1. **先备份。** 备份项目文件、数据库和当前部署配置；另外在后台记录或导出原主题设置。
2. **保留原版 Warm。** 不要删除或覆盖 `src/themes/typecho-theme-warm/`，OXN 应放在独立的 `src/themes/typecho-theme-oxn/` 目录。
3. **同步 OXN 主题目录。** 使用同一维护版本中的完整 `src/themes/typecho-theme-oxn/`，不要只复制 `style.css` 或少数组件。
4. **同步共享依赖文件。** 按本节“必须同步的主题与核心文件”表格，同步 `src/pages/index.astro`、`src/lib/markdown.ts`、`src/lib/security-headers.ts`、`astro.config.mjs`、`package.json` 和 `bun.lock`。这些文件应来自同一版本，不能把不同分支或不同提交的文件混合使用。
5. **按需同步插件。** 只有需要拼音别名辅助功能时，才同步并启用 `src/plugins/typecho-plugin-pinyin/`。不要把其他主题或旧升级文档中的插件清单直接当作 OXN 的必装依赖。
6. **安装依赖并重新构建。** 在项目根目录按仓库当前使用的包管理器安装依赖，再执行项目规定的构建和部署流程。不要手工复制 `public/themes/` 下的构建产物来代替主题源码。
7. **在后台启用 OXN。** 进入主题管理，选择 Oxn Simple。原版 Warm 仍可保留，之后也可以切回使用。
8. **检查主题功能。** 至少检查首页、文章、独立页面、笔记（如已启用笔记插件）、评论、导航、页脚、图片和 iframe 嵌入。

#### 设置与数据迁移注意事项

- OXN 使用独立的主题配置标识 `typecho-theme-oxn`，不会读取或自动继承 `typecho-theme-warm` 保存的主题设置。
- 切换主题不会自动迁移 Warm 的主题选项。启用 OXN 后，应在 OXN 自己的设置页面重新配置；也可以使用 OXN 设置页面提供的 JSON 导入/导出功能备份 OXN 配置。
- 文章、独立页面、评论等内容仍保存在项目数据库中。正常切换主题不需要清空或重建数据库。
- 不要用主题目录替换整个 `src/themes/`，也不要整体覆盖 `src/lib/`、`src/pages/`、`src/db/`、`src/middleware.ts` 或 Cloudflare 环境配置。
- `src/lib/markdown.ts.sim` 和 `src/lib/markdown.ts.bak` 是对照备份，不是运行文件；实际运行时使用 `src/lib/markdown.ts`。
- 旧版迁移说明中出现的 Warm-CY 主题、Warm-CY 配套插件及其历史提交号属于另一套旧版本说明，不是当前 OXN 的目录或版本依据。请以当前分支的文件清单和本说明中的同步要求为准。



## 3. 与原版 Typecho Warm 的主要差异

| 项目 | 原版 Warm（`1119d`） | OXN（`24`） |
| --- | --- | --- |
| 主题身份 | `typecho-theme-warm` | 独立 ID：`typecho-theme-oxn` |
| 设置界面 | 原版的常规主题选项 | 增加 OXN 专属的 CY 风格设置区域和更多前台控制项 |
| 主题基础 | Typecho Warm | 基于 Warm 持续开发，保留基础结构并增加 OXN 自定义功能 |
| 首页置顶 | 原版没有 OXN 这套按文章 ID 管理的置顶界面 | 可配置多个文章 ID，只作用于首页 |
| 顶部快捷操作 | 原版基础导航 | 可单独控制明暗切换、搜索和后台登录入口 |
| 评论管理操作 | 原版评论交互 | 管理员可在文章/独立页面评论区使用管理操作；可控制前台管理按键是否显示 |
| 页脚 | 原版社交信息和基础页脚 | 增加 10 组自定义页脚链接及自定义 HTML |
| 文章声明 | 原版没有 OXN 这套声明设置 | 支持 HTML、站点/文章变量，显示在文章正文之后、评论之前 |
| 密码文章表单 | 原版页面样式 | 与 404 搜索表单共用一套控件样式 |
| 搜索 | 原版基础页面 | 顶部搜索弹窗 |
| 管理弹窗 | 原版基础交互 | 搜索、置顶、删除等弹窗采用统一圆角与字号规范 |
| 暗色模式 | 原版基础配色 | OXN 统一主题变量，并对标题、正文加粗等暗色文字做了对比度调整 |
| 代码块 | 原版代码展示 | 增加复制图标，复制成功显示绿色勾号 |
| 图片 | 原版基础排版 | 正文图片限制在阅读栏宽度内，统一小圆角；支持主题图片参数 |
| 笔记媒体 | 依赖笔记插件数据 | 笔记图片网格、更多图片展开、视频、音频和附件卡片 |
| 文章目录 | 原版基础内容展示 | 自动识别正文 H2/H3，达到条件时生成目录 |
| 列表加载 | 保留手动/自动模式 | 支持手动加载、滚动加载两次和无限滚动，并可独立配置评论加载 |

以上对比描述的是当前 OXN 代码和已知原版配置，不代表原版项目所有历史版本的差异。

## 4. 后台设置说明

进入后台的主题设置页面，选择 OXN 后可以看到 OXN 自己的设置区域。不同设置的作用范围如下。

### 4.1 主题功能按键

| 设置项 | 开启后的前台表现 | 关闭后的表现 |
| --- | --- | --- |
| 明暗切换 | 页头显示模式切换按键，可选择明亮、跟随系统、暗黑 | 隐藏主题切换按键 |
| 搜索按键 | 页头显示搜索图标，点击打开搜索弹窗 | 隐藏顶部搜索入口 |
| 登录按键 | 页头显示后台入口图标 | 隐藏前台后台入口，不影响后台本身 |
| 评论区管理按键 | 在符合权限的文章/独立页面评论区显示管理员操作按键 | 只隐藏前台操作按键，不撤销后台管理权限，也不关闭管理接口 |

明暗模式支持明亮、跟随系统、暗黑三种状态。当前模式图标会随状态变化；选择结果保存在浏览器本地，页面切换后仍会沿用。

快捷入口的排列方式会根据启用数量调整：同时启用多个入口时，收纳到一个“快捷功能”菜单中；只启用一个入口时，直接显示对应功能，不额外套一层菜单。关闭某个开关只隐藏对应的前台入口，不会删除相关功能或改变后台权限。

### 4.2 首页置顶文章 ID

- 首页置顶文章 CID 使用独立数据库 option：`theme-pin:typecho-theme-oxn`。
- 主题设置页面通过专用接口读取当前 CID，并通过“保存置顶 CID”入口批量替换列表；该操作不经过普通主题设置保存接口。
- 多个 CID 可使用英文逗号、中文逗号或空白字符分隔；保存时会校验正整数、去重，并要求每个 CID 都对应已发布的普通文章（`post`）。
- 首页按置顶列表中的顺序展示文章，并避免这些文章在普通首页列表中重复出现。
- 独立置顶记录尚不存在时，读取逻辑会兼容旧主题配置中的 `pinnedIds`，以便承接旧数据。
- 置顶状态还会在管理员文章操作区显示，并可通过管理操作进行单篇置顶/取消置顶。

#### 评论区管理员置顶/取消置顶机制

评论区单篇操作与主题设置页的批量列表保存入口不同，但最终维护的是同一份独立置顶列表：

1. **操作入口：** 管理员在文章评论区的管理按键中点击置顶图标；只有普通文章（`post`）会生成置顶按键，独立页面不会出现该按键。
2. **二次确认：** 前台单篇置顶和取消置顶都必须在弹窗中完整输入“确认”；前端未输入正确内容时不会提交请求。
3. **独立 API：** 前端向 `POST /api/admin/theme-pin` 发送文章 ID（`cid`）、目标置顶状态（`pinned`）和确认文本（`confirmation`），同时携带 CSRF Token。
4. **后端身份与权限：** API 使用 `requireAdminAction(request, 'administrator')`，验证管理员登录状态、权限及 CSRF；不能只依赖前端是否显示管理按键。
5. **操作范围检查：** API 只在当前启用主题为 `typecho-theme-oxn` 时工作；文章必须存在、类型必须为普通文章（`post`），且状态必须为已发布（`publish`）。ID、布尔状态和确认文本也会在后端重新校验。
6. **列表写入：** 前台单篇操作从独立置顶 option 读取列表；置顶时将文章 CID 放到列表最前面并去重，取消置顶时只移除该 CID。
7. **数据库读回核验：** 写入后从独立置顶 option 重新读取，核对目标文章是否已置顶/已取消置顶。只有核验通过才返回成功，前端随后更新图标状态并显示操作结果。
8. **批量保存入口：** 主题设置页使用 `action: 'replace'` 提交完整 CID 列表；后端执行格式、重复项和已发布文章校验，写入后核对完整列表。该批量入口与前台单篇操作使用相同的独立 option 和首页缓存失效范围，但不等同于前台单篇确认弹窗流程。

`src/pages/api/admin/theme-pin.ts` 是前台单篇管理和主题设置页批量保存共同依赖的后端文件；仅复制评论组件而遗漏该 API，会导致置顶管理请求无法完成。
### 4.3 页脚链接

提供 10 组自定义链接，每组分别设置文字、网址和是否在新窗口打开：

- **文字：** 前台链接显示的内容。支持普通文字、完整 HTML、SVG 源码，以及 HTML、SVG 与文字混合输入。
- **Octicons 图标：** 可在文字栏开头填写 `{{octicon:mark-github}}` 或 `{{icons:mark-github}}`，标记后面可以继续填写文字；也可以在图标名称后追加 `-16` 或 `-24`，明确选择对应尺寸变体，例如 `{{octicon:sign-in-16}}`、`{{octicon:sign-in-24}}`。不带尺寸后缀时沿用默认选择规则；也可以直接填写完整 SVG/HTML。
- **网址：** 链接目标。支持完整的 `https://`、`http://`、`mailto:` 地址和站内相对链接；普通域名可直接填写，主题会自动补上 HTTPS。
- **新窗口：** 在每组的“网址”行中，网址输入框后面是“新窗口”复选框。勾选后使用新窗口打开链接；未勾选时在当前窗口打开。

**后台排列方式：** 每组分为两行：第一行是“文字”标签和文字输入框；第二行依次是“网址”标签、网址输入框和“新窗口”复选框。10 组使用相同结构，宽屏和窄屏均保持各自一行，不会在窄屏主动换行；屏幕较窄时输入框会相应收缩。该调整只改变后台设置项的排版，不改变字段名称、字段值、保存方式、链接生成规则或前台显示行为。

文字栏不是 Markdown 编辑器，链接文字与网址必须分别填写。空网址或无效网址不会生成页脚链接。HTML/SVG 会按原始片段输出，不会在这里额外验证标签完整性或执行 HTML 白名单清理；请确保标签完整闭合，只粘贴可信内容。

页脚还会按可用情况显示 RSS 站点链接。其他站点链接请通过上方的页脚自定义链接配置添加。

### 4.4 文章内容声明

文章内容声明用于在普通文章详情页添加版权说明、转载声明、来源说明或自定义提示。

- 留空时不显示。
- 仅文章详情页显示。
- 位于正文和文章标签之后、评论区之前。
- 笔记详情不显示文章声明。
- 支持 HTML。文章声明由管理员填写，当前主题不再对这段 HTML 额外执行独立白名单清理；主题只替换变量后直接输出。
- 支持下文列出的站点和当前文章变量。
- 变量替换值会进行 HTML 转义，避免变量内容被当成 HTML 标签解释；这不等于对管理员填写的 HTML 本身进行安全过滤。
- 因为声明 HTML 会直接输出，请只填写自己确认可信的内容，不要粘贴来源不明的脚本或第三方 HTML。

可用变量：

| 变量 | 替换内容 |
| --- | --- |
| `{site.name}` | 网站名称 |
| `{site.url}` | 网站首页地址 |
| `{site.description}` | 网站简介 |
| `{post.title}` | 当前文章标题 |
| `{post.url}` | 当前文章完整访问地址 |

示例：

```html
<div class="article-notice">
  <strong>版权声明</strong>
  <p>本文由「{site.name}」发布。</p>
  <p>文章：<a href="{post.url}">{post.title}</a></p>
  <p>转载请注明出处：{site.url}</p>
</div>
```

如需自定义样式，建议给声明自身使用独立 class，并将 CSS 选择器限制在该 class 下，避免影响全站其他元素。声明内容属于管理员主动填写的 HTML，请只填写可信内容；不要粘贴来源不明的脚本。

### 4.5 站点底部内容

- 支持填写 HTML。
- 显示在全站页脚链接和版权信息之前。
- 留空时不输出自定义内容。
- 其中的 `<style>` 样式会由主题处理并限制到页脚自定义内容容器内，避免普通选择器影响页面其他区域。
- 不要把不可信来源的脚本或 HTML 粘贴到这里。

### 4.6 图片优化参数

**图片优化参数**

- 用于主题正文内容中的站内图片，以及笔记原图/灯箱打开的图片。
- 示例：`?quality=80`。
- 参数会由主题转换为图片服务使用的 URL 参数。
- `width`、`height` 可转换为 EdgeOne 的 resize 参数；`format` 支持映射为格式参数。
- 图片服务自身支持的其他参数会按原样保留。
- 具体压缩质量仍取决于图片服务的配置，不能仅凭填写参数保证所有图片都会按指定质量重新编码。

**缩略图优化参数**

- 用于主题缩略图位置，例如笔记图片网格和列表中的缩略图。
- 示例：`?quality=80&width=500`。
- 留空时回退使用“图片优化参数”。
- 正文图片和缩略图可分别配置尺寸。

参数示例：

```text
图片优化参数：?quality=80&format=webp
缩略图优化参数：?quality=75&width=500&format=webp
```

### 4.7 内容列表

控制首页、分类和笔记内容列表的后续页面加载方式。

| 选项 | 行为 |
| --- | --- |
| 手动加载 | 默认方式。用户点击“加载更多”才请求下一页 |
| 滚动加载 2 次 | 用户开始滚动后，最多自动触发两次后续加载；之后仍可手动点击 |
| 无限滚动加载 | 用户滚动到加载位置时持续加载后续页，直到内容结束 |

加载失败会显示重试提示。分页仍保留上一页/下一页地址语义。用户选择“手动加载”时，不会因为页面滚动而自动请求下一页。

**当前已知限制（静态代码排查确认）：** 在“滚动加载 2 次”或“无限滚动加载”模式下，如果一次自动加载失败，随后用户点击“加载更多”并成功，当前脚本会清除暂停标记，但没有重新创建滚动观察器。因此后续自动加载可能不会恢复，需要继续手动点击。该问题尚未修复，本次没有改动加载逻辑。

### 4.8 评论组件

控制评论表单组件及其表单配置何时加载。

| 选项 | 行为 |
| --- | --- |
| 手动加载 | 用户主动触发后再加载评论组件 |
| 停留 3 秒加载 | 页面停留达到设定时间后加载 |
| 自动加载 | 页面初始化时加载 |

该项控制评论组件/表单的加载时机，不等同于评论列表的分页加载方式。

### 4.9 评论列表

控制评论内容列表的初始加载及后续分页。

| 选项 | 行为 |
| --- | --- |
| 手动加载 | 用户主动点击后加载评论列表 |
| 加载第一页 | 自动加载第一页，后续页仍按分页交互 |
| 滚动加载 2 次 | 滚动时最多自动加载两次后续评论 |
| 无限滚动加载 | 滚动到列表底部时持续加载，直到评论全部加载 |

“评论组件”和“评论列表”是两个独立设置：前者决定评论表单何时出现，后者决定评论内容何时加载及如何翻页。

### 4.10 主题设置导出与导入

OXN 后台主题设置页在原有保存按钮旁提供：

- **导出设置：** 将当前 OXN 主题配置导出为本地 JSON 文件，按钮位于保存设置按钮旁，并使用下载图标。
- **导入设置：** 选择此前导出的 JSON 备份，校验文件格式、版本和来源主题字段后，确认导入；按钮使用上传图标。
- 当前导出格式为 `oxn-theme-config`、版本 `1`，包含 `sourceTheme` 和 `settings`；导入时也兼容旧版 `oxn-theme-settings` 格式。
- 导入会覆盖备份文件中包含的当前 OXN 对应设置项；备份中没有出现的设置项不会因为导入而主动清空。
- 首页置顶 CID 虽然会随导出写入备份，但它使用独立 option 保存。导入时只会把备份中的 CID 列表填回“首页置顶文章 ID”输入框，不会自动写入数据库；需要再点击“保存置顶 CID”完成独立保存。普通主题设置仍需点击后台原有的“保存设置”。
- 备份只包含 OXN 主题配置，不是数据库备份，也不包含其他主题、插件或系统配置。
- 这是手动备份/恢复，不是主题切换时自动保存或自动恢复。切换主题前先导出；切回 OXN 后再导入备份。

建议每次进行大规模主题设置调整前先导出一份 JSON 备份。

### 4.11 独立页面导航名称与图标

顶部导航会读取独立页面的两个自定义字段：

| 自定义字段 | 用途 |
| --- | --- |
| `name` | 自定义该独立页面在顶部导航中的显示名称；有内容时替代页面原始标题 |
| `icons` | 自定义导航图标；支持完整 HTML/SVG 片段及 Octicons 图标名称标记 |

图标输入示例：

```html
<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z"></path>
</svg>
```

也可以使用 Octicons 名称标记：

```text
{{octicon:mark-github}}
```

当前共享解析函数还兼容 `{{icons:mark-github}}` 和不带标记的 Octicons 名称。单数形式 `{{icon:mark-github}}` 不属于当前支持语法。图标字段按 HTML 片段直接输出，因此可以将 SVG 与其他 HTML/文字放在同一字段中；当前不会验证标签是否完整，也不会在此处执行 HTML 白名单清理。请确保标签完整闭合，只输入可信的 HTML/SVG 内容。未闭合的 SVG/HTML 可能影响其后的页面结构和页脚链接显示。

当前导航显示规则（`name` 与 `icons` 独立判断）：

| `name` 字段 | `icons` 字段 | 导航栏显示 |
| --- | --- | --- |
| 不存在 | 有效图标 | 图标 + 独立页面原始标题 |
| 不存在 | 无有效图标 | 独立页面原始标题 |
| 有内容 | 有效图标 | 图标 + 自定义 `name` |
| 有内容 | 无有效图标 | 自定义 `name` |
| 存在但为空 | 有效图标 | 仅显示图标，不显示文字 |
| 存在但为空 | 无有效图标 | 不显示该导航项目 |

具体规则：

- `name` 字段不存在：使用独立页面原始标题。
- `name` 字段存在且有内容：使用自定义名称，替代原始标题。
- `name` 字段存在但值为空：不显示任何文字；不会回退到原始标题。
- `icons` 有效时显示图标；为空或无法解析时不显示图标。
- 两个字段互不兜底：图标是否显示不改变名称判断，名称是否为空也不改变图标判断。
- 当 `name` 为空且没有有效图标时，该导航项目整体隐藏。

注意：这里的“有效图标”指主题能够解析并输出的 Octicons 名称或非空 HTML/SVG 片段。

导航图标容器使用自适应宽度；其中 SVG 固定为 16×16，并设置不可收缩，避免 SVG 后面出现数字、文字或其他 HTML 时被 Flex 布局挤小。该规则是导航图标的布局规则，不会把整个自定义 HTML 片段强制限制为 16px 宽。页脚 SVG 当前使用 15×15 且同样禁止收缩；页脚容器与顶部导航的间距规则并非完全相同。

页脚自定义链接与顶部独立页面导航是两套不同的配置入口：页脚每组仍使用文字栏、网址栏和新窗口选项；图标标记需要放在文字栏开头。页脚不是 Markdown 编辑器，`[{{icon:mark-github}}](https://example.com)` 这种 Markdown 链接写法不能代替后台的文字栏和网址栏。

### 4.12 OXN 设置独立性

OXN 使用独立的主题配置标识 `typecho-theme-oxn`。OXN 前台读取的主题设置全部来自 OXN 自己的配置，不读取 `typecho-theme-warm` 的配置，也不以 Warm 的已保存值作为缺省补充。

Warm 原版继续使用自己的配置；两套主题设置互不共享、互不兜底。OXN 保留自己的图片参数、列表加载方式、评论组件加载方式、评论列表加载方式以及其他主题功能设置。

### 4.13 自定义导航按键名称

在“主题功能按键”卡片中，评论区管理按键说明下方提供“自定义导航按键”区域，可分别修改首页、文章、笔记三个固定导航项目的显示名称。

| 输入项 | 对应导航项目 | 默认显示名称 |
| --- | --- | --- |
| 首页 | 首页入口 | 首页 |
| 文章 | 文章入口及其下拉菜单标题 | 文章 |
| 笔记 | 笔记流入口 | 笔记 |

使用规则：

- 输入自定义名称后，该内容替换对应导航项目的默认名称。
- 输入框留空时，前台回退显示默认名称“首页”“文章”或“笔记”；留空不会隐藏该导航项目，也不会生成空白导航按钮。
- 这三个输入项只负责修改固定导航项目的显示内容，不负责新增、删除或改变导航项目的链接地址和功能。
- 输入格式参照“页脚文字”：可使用普通文字，也可使用主题支持的图标标记、HTML/SVG 片段及文字混合内容。图标标记可放在文字前面；例如 `{{octicon:mark-github}}` 或 `{{icons:mark-github}}`。HTML/SVG 片段会按主题现有渲染规则处理，请保证标签完整并只输入可信内容。
- 这三个名称保存在 OXN 自己的主题配置中，与独立页面的 `name`、`icons` 自定义字段不是同一套设置。独立页面的导航名称和图标仍按 4.11 节的规则单独处理。

**窄屏布局：** 首页、文章、笔记三个标签分别与自己的输入框保持同行。窄屏时输入框允许收缩，但不会把标签和输入框拆成上下两行。该规则仅影响后台设置界面，不改变前台导航的响应式布局。

### 4.14 后台设置界面布局与功能边界

最近的后台设置界面整理属于显示层调整，目的是让字段关系更直观，不改变主题配置的数据结构：

1. “自定义导航按键”区域与上方主题功能按键分隔显示，三个标签和输入框同行。
2. “页脚连接”统一为 10 组，每组均包含文字、网址、新窗口三个设置字段；网址输入框与新窗口复选框位于同一行。
3. “新窗口打开”仅缩短显示文案为“新窗口”，复选框本身及其对应字段没有改变。
4. 后台布局调整不改字段 key，不改默认值，不改隐藏字段同步，不改主题设置提交机制，也不改前台链接或导航渲染逻辑。
5. 明暗切换、搜索、登录三个顶部快捷入口根据启用数量切换显示方式：多个入口时收纳到快捷功能菜单；仅一个入口时直接显示该功能。单入口与菜单触发位置使用相同的 32×32 布局占位，避免因外层容器尺寸不同造成导航整体位移。评论区管理按键不计入这三个顶部快捷入口的数量。

以上是当前代码中的设置和布局规则。后台表单的实际显示宽度仍会受到 Typecho 后台外层容器、浏览器缩放比例和屏幕可用宽度影响。
## 5. 前台页面与功能说明

### 5.1 首页、文章列表与分类

- 首页使用单栏文章流。
- 文章卡片显示发布时间、分类、标题和摘要。
- 首页置顶文章按后台 ID 设置展示。
- 分类、归档等列表沿用主题列表样式和分页组件。
- 列表后续页加载行为由“内容列表”设置控制。

### 5.2 笔记流

启用 `typecho-plugin-notes` 后，主题可显示笔记入口和笔记内容。

- 顶部导航出现“笔记”入口。
- 支持笔记列表和话题筛选。
- 首页可根据请求参数显示文章与笔记混合流；也可进入单独笔记流。
- 笔记详情不显示普通文章标题区、文章标签和文章内容声明。
- 笔记正文由笔记插件提供，主题负责排版及媒体展示。
- 笔记图片以网格显示，超过四张时可点击 `+N` 展开剩余图片。
- 笔记正文末尾的内容块不再被强制改成横向 flex 布局，避免末尾图片或媒体内容横向溢出；正文末尾块统一清除多余底部间距。
- 支持笔记视频、音频播放器和附件链接卡片。
- 笔记媒体展示依赖笔记插件提供的数据；未启用插件时，主题不会凭空生成笔记内容。

### 5.3 文章详情

普通文章详情页包含：

- 分类、发布时间和预计阅读时间。
- 文章标题和可用的摘要。
- 正文、文章目录（符合生成条件时）。目录跟随正文滚动更新当前标题；点击目录项时展开标题文字，点击目录外区域后收起文字，仅保留目录横线状态。
- 标签。
- 可用时显示文章内容声明。
- 评论组件和评论列表。

文章摘要可使用已安装并启用的 Intelligence 插件生成的智能摘要；没有摘要时使用文章内容生成普通摘要。未通过密码验证的文章不会泄露正文摘要。

### 5.4 密码保护文章

密码文章继续使用项目原有的文章密码验证流程，主题只负责展示输入界面：

- 未验证时不输出受保护的正文。
- 显示提示“此内容已加密，请输入密码访问。”
- 输入框使用 `type="password"`，输入内容默认隐藏。
- 表单通过 GET 参数 `password` 提交当前文章密码。
- 密码验证成功后由原有页面数据流程提供正文。
- 密码表单与 404 搜索表单共用 `warm-compact-form` 这一套布局和控件样式。
- 密码文章未验证时不会输出普通正文摘要，也不会显示正文目录。

主题没有另造一套密码验证接口，也不会因为隐藏输入框就绕过原有权限验证。

### 5.5 独立页面与自定义页面模板

默认独立页面使用 OXN 的全站外壳、导航、页脚和文章正文排版。评论开启且满足条件时显示评论区。管理员在有权限且前台管理按键开关开启时，可看到对应管理入口。

OXN 另外注册了一个可选的独立页面模板：

- **文章归档**：在后台新建或编辑独立页面时，在页面模板选项中选择“文章归档”。
- 归档页面按站点时区将已发布且已到发布时间的普通文章按年份分组，年份倒序排列。
- 每个年份显示文章数量；每篇文章显示月-日和标题，标题链接到原文章。
- 页面保留 OXN 全站外壳、响应式布局及独立页面正文/评论能力。
- 这是独立页面的可选模板，不替换默认独立页面模板，也不改变其他独立页面。

模板由 `theme.json` 的 `pageTemplates.archives` 注册，组件位于 `components/Archives.astro`。

### 5.6 评论与管理员操作

评论区域由独立组件管理，包含：

- 评论表单和评论者信息。
- 评论列表、回复关系和分页。
- 评论状态提示。
- 根据站点评论设置显示 Markdown 提示。
- 根据站点配置控制头像、网址、邮箱等字段。
- 评论表单可传递密码文章上下文和安全令牌。
- 管理员可看到编辑、删除等操作；普通访客不会因为前台按钮设置而获得管理权限。

文章/独立页面的管理操作按内容类型区分：

- 文章：置顶/取消置顶、编辑、删除。
- 独立页面：编辑、删除，不提供文章置顶。
- 删除、置顶等危险操作通过主题管理弹窗确认。
- 管理操作仍由已有后台权限和管理接口校验；隐藏按钮不是安全边界。

### 5.7 搜索、导航和页脚

- 顶部搜索图标打开搜索弹窗，提交后使用站内搜索参数。
- 404 页面提供搜索表单，使用与密码文章表单相同的紧凑表单样式。
- 顶部快捷操作可按后台开关分别显示。
- 导航包含首页、文章下拉菜单、可用的笔记入口和已配置的独立页面；独立页面可通过自定义字段 `name` 覆盖显示名称，通过 `icons` 设置 Octicons、SVG 或 HTML 图标。
- 导航图标支持 HTML/SVG 混合片段；SVG 固定 16×16 且不参与 Flex 收缩，旁边的文本不会挤压图标。
- 页脚可显示 10 组自定义链接、RSS、GitHub、社交信息及 Email，并支持站点底部自定义 HTML；自定义链接仍使用分开的文字栏、网址栏和新窗口设置。
- OXN 页面在 head 中引用主题目录内的 SVG favicon，并提供 ICO 回退图标；后台主题预览图由 `theme.json` 的 `screenshot` 字段指向 `assets/screenshot.png`。

### 5.8 文章归档页面

文章归档不是自动替换的站点归档路由，而是一个可选的独立页面模板。使用方法：

1. 后台进入“管理独立页面”，新建或编辑一个页面。
2. 在页面模板选项中选择“文章归档”。
3. 保存后访问该独立页面，即可查看按年份分组的文章列表。

归档数据只包含已发布且发布时间不晚于当前时间的普通文章，不包含草稿、待审核内容或笔记。年份分组使用站点配置的时区，年份按倒序排列；每年显示文章数，每篇显示月-日及原文章链接。

### 5.9 图标来源与授权

OXN 的图标主要来自 GitHub Primer Octicons，项目依赖为 `@primer/octicons`，遵循 MIT License。上游许可证全文保存在 `OCTICONS-LICENSE.txt`；中英双语说明及 OXN favicon、自定义 SVG/HTML 的授权边界见 [ICONS-LICENSE.md](./ICONS-LICENSE.md)。

再分发包含 Octicons 的主题副本时，应同时保留图标授权说明和上游许可证文本。自定义输入的 SVG/HTML 不因主题渲染而自动获得 MIT 授权，使用者应自行确认其使用权利。

### 5.10 图标库的使用与增加方法

OXN 使用 GitHub Primer Octicons 作为内置图标库。依赖声明位于主题自己的 `package.json`：

```json
{
  "dependencies": {
    "@primer/octicons": "^19.42.0"
  }
}
```

图标目录由 `components/octicons.ts` 从 `@primer/octicons` 导入。当前实现会读取依赖包提供的图标数据，并按名称解析 SVG；**没有单独维护一份需要逐个登记的图标名称数组**。因此，Octicons 上游版本中已经包含的图标，通常不需要再向 `octicons.ts` 手动添加名称，按正确名称调用即可。

#### 方法一：使用当前版本已经包含的图标

1. 先在 [Primer Octicons 官方图标目录](https://primer.style/octicons/) 查找需要的图标。
2. 记录图标名称。名称使用小写 kebab-case，例如 `mark-github`、`home`、`sign-in`。
3. 在支持图标标记的文字字段中填写图标标记，例如：

```text
{{octicon:mark-github}}
```

也可以使用兼容旧写法：

```text
{{icons:mark-github}}
```

图标后面可以直接接普通文字或 HTML：

```text
{{octicon:mark-github}} GitHub
```

如果名称写错、当前依赖版本中不存在该图标，解析结果为空；这不代表需要修改页面 CSS，首先应核对图标名称和依赖版本。

#### 方法二：选择尺寸、添加提示文字

当前解析器支持两种尺寸控制方式。

**在图标名称中指定 16 或 24 高度变体：**

```text
{{octicon:sign-in-16}}
{{octicon:sign-in-24}}
```

这种写法要求对应图标确实提供该高度变体。没有尺寸后缀时，解析器优先选择 16 高度；如果没有 16，则选择该图标可用的最小高度变体。

**使用参数指定输出尺寸和提示文字：**

```text
{{octicon:home|size=20|title=返回首页}}
```

- `size`：输出 SVG 的宽度和高度，必须是 1 至 256 的正整数。
- `title`：可访问性名称；设置后会生成 SVG 的 `<title>`、`role="img"` 和 `aria-label`。
- 参数之间使用英文竖线 `|` 分隔。
- 不设置参数时，使用调用位置传入的默认尺寸；当前共享输入渲染函数的默认值为 16。

例如，页脚文字栏、导航名称等位置可以使用：

```text
{{octicon:home|size=16|title=首页}} 首页
```

#### 方法三：把上游新图标加入当前项目可用目录

如果官方 Octicons 已经发布了某个新图标，但当前项目安装的 `@primer/octicons` 版本还没有它，需要更新主题依赖，而不是只在页面输入新名称。

1. 确认该图标已经出现在 [Primer Octicons 官方目录](https://primer.style/octicons/) 和上游发布版本中。
2. 查看主题目录下的 `src/themes/typecho-theme-oxn/package.json`，将 `@primer/octicons` 的版本范围更新到包含该图标的正式版本。
3. 在仓库根目录执行 `bun install`，让工作区依赖和根目录 `bun.lock` 同步更新。
4. 检查安装后的依赖版本确实包含该图标，并确认图标名称与官方目录一致。
5. 重新构建项目，再用 `{{octicon:图标名称}}` 调用。

因为 `octicons.ts` 是从依赖包整体读取图标目录，更新依赖后，新版本包含的图标会自动进入可解析目录；通常不需要为每个新图标单独修改解析函数。不要只改 `package.json` 而不更新 `bun.lock`，否则不同环境安装到的依赖版本可能不一致。

#### OXN 内置自定义图标：Bilibili

除上游 Octicons 外，OXN 也可以在本地目录中登记主题专用图标。当前已加入一个名称为 `bilibili` 的自定义图标，使用的是项目维护者提供的 18 × 18 SVG 路径，不属于上游 Octicons 图标集。

调用方式与其他图标一致：

```text
{{octicon:bilibili}}
```

也可以指定输出尺寸和辅助提示文字：

```text
{{octicon:bilibili|size=18|title=Bilibili}}
```

旧标记同样兼容：

```text
{{icons:bilibili}}
```

这个图标注册在 `components/octicons.ts` 的 `customIcons` 中，与上游 `@primer/octicons` 目录合并后统一解析。今后增加 OXN 专用图标时，应继续放在 `customIcons`，不要直接修改上游依赖数据；同时注明图标来源和适用授权。

#### 方法四：加入项目自己的自定义图标

如果需要的图标不属于 Octicons（例如 OXN 自有图标或其他图标集），它不会因为更新 `@primer/octicons` 而自动出现。此时有两种做法：

- **只在某个位置使用一次：** 直接在支持 HTML/SVG 的输入字段中粘贴完整 SVG，不必把它加入全局图标目录。
- **希望全站都能通过名称调用：** 需要开发修改 `components/octicons.ts`，为自定义图标建立与现有目录兼容的数据定义，并将自定义目录与上游 Octicons 目录合并后再交给 `resolveOcticon()` 查询。自定义定义至少要提供图标的路径数据、宽度，以及对应的高度变体；不能只增加一个名称字符串。

全局目录扩展属于代码修改，不是后台输入操作。新增图标时应使用有明确授权的 SVG 路径数据，并记录来源和许可证；不要把 OXN favicon 或其他没有 Octicons 授权的品牌图形误标为 MIT 授权的 Octicons。

#### 当前支持范围与注意事项

- 支持标记：`{{octicon:名称}}`、兼容标记 `{{icons:名称}}`。
- 不支持单数形式：`{{icon:名称}}`。
- 兼容不带标记的裸图标名称；在普通文本字段中，建议始终使用明确的双大括号标记，避免普通文字被误判为图标名称。
- 标记可以放在文字开头，标记后面的普通文字会继续输出；若后面是 HTML 片段，则按 HTML 片段追加输出。
- `title` 会进行 HTML 转义；图标 SVG 由主题从图标库生成。
- 完整 HTML/SVG 输入会按当前字段既有规则输出，不会自动转换成 Octicons，也不会自动加入全局图标目录。只粘贴可信内容，并确保标签完整闭合。
- 页脚文字、固定导航名称、独立页面 `icons` 字段等位置共用图标输入解析能力，但各自的字段用途和外围布局仍然不同。

图标来源及再分发要求见本目录的 `ICONS-LICENSE.md` 和 `OCTICONS-LICENSE.txt`。更新或扩展图标库时应保留上游许可证文件。

### 5.11 图片、灯箱和代码块

- 正文图片最大宽度限制在文章阅读区域内，保持原始宽高比例。
- 正文图片使用统一的 4px 小圆角，并限制在阅读栏宽度内；带 `width`/`height` 的图片按实际尺寸比例显示，不再被无条件拉伸。
- 笔记图片使用网格布局，图片点击后进入图片查看器。
- 图片优化参数和缩略图参数由主题配置控制。
- 代码块右上角提供复制图标；桌面端默认在鼠标悬停或键盘聚焦代码块时显示，触屏设备常驻显示。复制成功短暂显示绿色勾号，随后恢复复制图标；优先使用 Clipboard API，不可用时回退到传统复制方式。
- 图片查看与页面切换脚本会处理页面 DOM 更新后的绑定。

## 6. 文章内容输入格式与示例

本节根据当前共享 Markdown 解析器、HTML 清理配置、Alerts 转换逻辑及 OXN 正文样式逐项核对。普通文章和独立页面使用项目共享的 Markdown 转换与 HTML 清理流程；笔记正文由笔记插件调用同一套 Markdown 渲染能力。内容在服务端生成 HTML，主题直接输出处理后的 HTML，客户端不再重新解析 Markdown。

正文处理顺序为：识别 Typecho 内容标记 → Marked 解析 Markdown（使用 GFM 默认语法）→ 转换 GitHub 风格 Alerts → sanitize-html 按标签、属性和 iframe 主机白名单清理 → OXN 主题排版。

**下面的代码块均为文章编辑器可使用的输入示例。** Markdown 和原生 HTML 可以混合编写。HTML 能否保留取决于共享清理规则；标签被允许不代表任意属性也会保留。

### 6.1 标题

支持 ATX 标题：

~~~markdown
# 一级标题
## 二级标题
### 三级标题
#### 四级标题
##### 五级标题
###### 六级标题
~~~

支持 Setext 标题：

~~~markdown
一级标题
========

二级标题
--------
~~~

标题生成 H1—H6。主题会设置各级标题的字号、行高和间距。文章目录只提取 H2、H3；至少存在两个有效标题时才显示目录，并为标题生成锚点 ID。

### 6.2 段落、换行与分隔线

段落之间空一行：

~~~markdown
这是第一段文字。

这是第二段文字。
~~~

同一段落内强制换行，可在行尾添加两个空格：

~~~markdown
这是第一行。  
这是第二行。
~~~

分隔线支持三个或更多短横线、星号或下划线：

~~~markdown
上半部分内容。

---

下半部分内容。
~~~

### 6.3 文字强调、删除线与行内语义标签

Markdown 支持粗体、斜体和删除线：

~~~markdown
**粗体文字**

*斜体文字*

~~删除线文字~~

普通文字中也可以混合 **粗体**、*斜体* 和 ~~删除线~~。
~~~

需要下划线、上下标、标记文字等效果时，可以使用 HTML：

~~~html
<p>这是 <u>带下划线</u> 的文字。</p>
<p>水的分子式：H<sub>2</sub>O；数学平方：x<sup>2</sup></p>
<p><mark>重点标记</mark>，<small>小号文字</small>。</p>
<p><abbr title="HyperText Markup Language">HTML</abbr>、<kbd>Ctrl</kbd>、<code>inline code</code></p>
~~~

### 6.4 引用与嵌套引用

普通引用：

~~~markdown
> 这是一段引用。
>
> 引用可以包含多个段落。
~~~

嵌套引用：

~~~markdown
> 第一层引用
>
> > 第二层引用
> >
> > > 第三层引用
~~~

引用内部可以继续使用段落、强调、链接、列表和代码等 Markdown 内容。HTML 也可以直接使用 blockquote 标签。

### 6.5 无序列表、有序列表、嵌套列表与任务列表

无序列表支持短横线、星号和加号：

~~~markdown
- 苹果
- 香蕉
  - 国产香蕉
  - 进口香蕉
+ 橙子
* 葡萄
~~~

有序列表及嵌套列表：

~~~markdown
1. 准备材料
   1. 面粉
   2. 鸡蛋
2. 开始制作
3. 完成
~~~

任务列表语法：

~~~markdown
- [x] 已完成的事项
- [ ] 尚未完成的事项
~~~

任务列表的条目和文字会保留；当前 HTML 清理规则会移除复选框对应的 input 控件，因此前台按普通列表内容显示，不会呈现可交互复选框。

### 6.6 链接、引用式链接、自动链接与邮箱

行内链接：

~~~markdown
[项目主页](https://github.com/oxn/typecho-workers)

[站内页面](/about/)

[带标题的链接](https://example.com "鼠标悬停标题")
~~~

引用式链接：

~~~markdown
这里引用了 [项目主页][project]。

[project]: https://github.com/oxn/typecho-workers "项目主页"
~~~

裸 URL 和邮箱会自动识别为链接：

~~~markdown
https://example.com

https://github.com/oxn/typecho-workers

name@example.com
~~~

也可以使用 HTML：

~~~html
<a href="mailto:name@example.com">给我发送邮件</a>
<a href="https://example.com" title="站点说明" target="_blank" rel="noopener">外部链接</a>
~~~

链接支持 href、title、target、rel 属性；链接地址仍会经过协议安全校验。

### 6.7 图片、图片标题、图注与尺寸输入

普通 Markdown 图片：

~~~markdown
![图片替代文字](https://example.com/images/photo.jpg)

![带标题的图片](https://example.com/images/photo.jpg "图片标题")
~~~

**新增：可直接在图片 URL 后填写宽高参数。** 当前共享 Markdown 处理文件支持以下两种 URL 写法：

~~~markdown
![图片说明](https://example.com/images/photo.svg&width=880&height=192)

![图片说明](https://example.com/images/photo.svg#blurhash=示例参数&width=880&height=192)
~~~

两种写法都会提取有效的 `width`、`height`，并将尺寸写入最终生成的 `<img>` 标签。例如，第二种写法最终会得到类似：

~~~html
<img
  src="https://example.com/images/photo.svg"
  alt="图片说明"
  width="880"
  height="192">
~~~

处理规则：

- 宽度和高度分别读取，可以只提供其中一个。
- 尺寸必须是正整数，最大值为 `16384`；超出范围或无效的值不会作为尺寸属性写入。
- URL 中的普通查询参数会保留。
- 如果 URL 含有 `#`，最终图片地址会去掉 `#` 及其后面的 fragment 内容；因此 `blurhash` 等 fragment 信息不会进入最终的图片请求地址。
- 如果 URL 不含 `#`，会从 URL 中移除识别到的 `width`、`height` 参数，其他正常参数保留。
- 没有识别到有效尺寸时，不会凭空推断图片宽高。

HTML 图片仍可直接填写尺寸属性：

~~~html
<img
  src="https://example.com/images/photo.jpg"
  alt="图片说明"
  title="图片标题"
  width="800"
  height="450"
  loading="lazy">
~~~

带图注的图片：

~~~html
<figure>
  <img src="https://example.com/images/photo.jpg" alt="山间风景">
  <figcaption>山间风景照片说明</figcaption>
</figure>
~~~

图片允许使用 `src`、`alt`、`title`、`width`、`height`、`loading` 等属性。正文图片会限制在阅读区域内，保持宽高比例并使用小圆角；主题图片优化参数会按设置处理符合条件的图片 URL。

**语法范围说明：** 当前 `24` 的 `src/lib/markdown.ts` 已核实并实现的是上述 URL 参数写法；`{width=880 height=192}` 这种放在 Markdown 图片语法外部的花括号写法，在当前文件中没有对应解析逻辑，因此暂不列为当前版本已支持的输入格式。

### 6.8 行内代码、围栏代码块与缩进代码

行内代码可使用一对反引号包围，例如在正文中标记命令、变量名或文件名。

围栏代码块可在代码前后各使用三个反引号，也可以使用三个波浪号；开始标记后可添加语言名称，例如 ts、js、html、css、bash、json、sql。

~~~ts
interface User {
  id: number;
  name: string;
}

const user: User = {
  id: 1,
  name: "Oxn",
};
~~~

缩进代码块：

~~~text
    这是缩进代码块。
    每行前面缩进四个空格。
~~~

语言标识会保留在代码块 class 中；主题提供复制按钮。语言标识本身不代表系统一定配置了对应的语法高亮器。

### 6.9 GitHub 风格表格与列对齐

基本表格：

~~~markdown
| 名称 | 说明 | 状态 |
| --- | --- | --- |
| 文章 | 普通文章内容 | 已支持 |
| 笔记 | 笔记插件内容 | 已支持 |
| 页面 | 独立页面 | 已支持 |
~~~

每列可分别指定左对齐、居中或右对齐：

~~~markdown
| 左对齐 | 居中 | 右对齐 |
| :--- | :---: | ---: |
| 左侧内容 | 中间内容 | 100 |
| 示例文字 | 示例文字 | 200 |
~~~

未指定对齐方式时，表头和正文默认统一左对齐；指定对齐方式后，该列的表头和正文使用相同对齐方式。此调整只处理对齐，不改变现有表格布局；窄屏内容仍可横向查看。

### 6.10 GitHub 风格提示块（Alerts）

使用引用语法和 [!类型] 标记：

~~~markdown
> [!NOTE]
> 这是一条说明。

> [!TIP]
> 这是一条技巧提示。

> [!WARNING]
> 这是一条警告提示。

> [!IMPORTANT]
> 这是一条重要提醒。

> [!CAUTION]
> 这是一条需要谨慎处理的内容。
~~~

上述五种类型均有独立颜色样式，类型名称不区分大小写。提示块上下间距为 `1.5em`，最后一个子元素不额外保留底部间距。也可以使用其他非空标题，例如 [!CUSTOM]；这类内容同样会转换为提示块并显示标题，但使用通用提示块样式，不会自动获得五种预设颜色。

### 6.11 HTML 混合输入与常用结构标签

Markdown 正文可以直接混合 HTML。块级 HTML 示例：

~~~html
<div>
  <p>这是一个 HTML 段落。</p>
  <p>可以使用 <strong>粗体</strong>、<em>斜体</em>、<u>下划线</u>。</p>
  <p>也可以使用 <del>删除线</del>、<ins>插入标记</ins>、<mark>重点标记</mark>。</p>
</div>
~~~

行内 HTML：

~~~html
<p>普通文字中插入 <strong>加粗</strong>、<code>代码</code> 和 <a href="https://example.com">链接</a>。</p>
~~~

本节对应 `src/lib/markdown.ts` 中的 `SANITIZE_OPTIONS`，适用范围是普通文章、独立页面和笔记正文的共享 Markdown/HTML 清理流程；它不是 OXN 主题专属白名单，也不是 Typecho 全系统所有 HTML 输出的统一白名单。配置继承 sanitize-html 默认允许标签，并在此基础上扩展结构标签、表单标签、媒体标签和 SVG 图形标签。

本次扩展的主要标签按用途整理如下（同时保留 sanitize-html 默认允许的标签）：

| 类型 | 本次增加或重点支持的标签 |
| --- | --- |
| 页面结构 | div、span、section、article、main、header、footer、nav、aside |
| 文字语义 | small、u、mark、abbr、sub、sup、time |
| 列表与表格 | dl、dt、dd、tfoot |
| 表单控件 | form、fieldset、legend、input、select、option、textarea、output、progress、meter、button、label |
| 图片容器 | picture |
| SVG 基础图形 | svg、g、path、circle、rect、line、polyline、polygon、ellipse、text、tspan |
| SVG 资源与效果 | defs、use、symbol、mask、clipPath、filter、linearGradient、radialGradient、stop、style、image、title、desc、marker、pattern、feGaussianBlur、feOffset、feComponentTransfer、feFuncA、feMerge、feMergeNode |

属性采用通用规则与标签专属规则结合的方式：

| 范围 | 允许的属性或内容 |
| --- | --- |
| 通用属性 | class、id、title、style、role、aria-*、data-* |
| 链接 a | href、title、target、rel、download |
| 图片 img | src、alt、title、width、height、loading |
| iframe | src、width、height、frameborder、allowfullscreen、allow、sandbox、loading、referrerpolicy |
| video | src、controls、width、height、poster |
| source | src、srcset、sizes、type、media |
| 表单 | 按 input、select、option、textarea、button、label 等元素分别配置对应属性 |
| SVG | 按 SVG 元素分别配置坐标、尺寸、填充、描边、变换、渐变、滤镜及引用属性 |

内联 `style` 不再像旧版一样整体过滤。当前配置通过 `allowedStyles` 限定可用 CSS 属性，并对属性值执行正则检查；包括颜色、填充/描边、字体、背景、对齐、布局、尺寸、间距、边框、阴影和溢出等常见样式。配置会排除包含 `javascript:`、`expression()`、`@import`、`behavior:` 等危险片段的值。SVG 使用 `lowerCaseTags: false`，以兼容 `linearGradient`、`radialGradient` 等带大小写的 SVG 标签。

**白名单适用范围需要区分：**

- **文章、独立页面和笔记正文：** 使用本节对应的 `SANITIZE_OPTIONS`。笔记正文由笔记插件调用共享 `renderMarkdown()`，因此也走这套正文清理规则。
- **评论 Markdown：** 使用 `COMMENT_MARKDOWN_OPTIONS`，是单独的一套较窄规则，不继承正文白名单增加的全部标签和属性。
- **评论自定义 HTML：** 另根据后台 `commentsHTMLTagAllowed` 配置动态构建评论清理选项；它与评论 Markdown 的固定规则也不是同一套配置。
- **页脚自定义 HTML、文章内容声明：** 各自有独立处理流程，不应将本节正文白名单直接套用到这两项设置。

链接和媒体地址仍受安全协议校验；iframe 还会校验主机名。事件处理器属性（例如 `onclick`）不在允许列表中；未列入对应标签属性白名单或 CSS 属性规则的内容不会保留。

### 6.12 HTML 折叠内容（details / summary）

使用 details 包裹折叠区域，summary 作为点击标题。点击标题即可展开或收起内容；内部可以继续放段落、列表、图片、代码和其他允许的 HTML。

~~~html
<details>
  <summary>点击展开更多说明</summary>
  <p>这里是折叠区域中的内容。</p>
  <ul>
    <li>第一项</li>
    <li>第二项</li>
  </ul>
</details>
~~~

也支持嵌套折叠：

~~~html
<details>
  <summary>第一层内容</summary>
  <p>第一层说明。</p>
  <details>
    <summary>展开第二层</summary>
    <p>第二层折叠内容。</p>
  </details>
</details>
~~~

### 6.13 HTML 视频与音频

视频：

~~~html
<video src="https://example.com/video.mp4" controls width="800" height="450"></video>
~~~

使用多个视频源：

~~~html
<video controls width="800">
  <source src="https://example.com/video.mp4" type="video/mp4">
  当前浏览器不支持播放此视频。
</video>
~~~

音频：

~~~html
<audio src="https://example.com/audio.mp3" controls></audio>
~~~

视频允许 src、controls、width、height；音频允许 src、controls；source 允许 src、type。是否能够播放还取决于媒体资源地址、文件格式和浏览器支持情况。

### 6.14 iframe 视频嵌入

文章正文允许以下 iframe 主机：

- www.youtube.com
- www.bilibili.com
- player.bilibili.com
- player.vimeo.com

YouTube：

~~~html
<iframe
  src="https://www.youtube.com/embed/视频ID"
  width="560"
  height="315"
  frameborder="0"
  allowfullscreen>
</iframe>
~~~

Bilibili：

~~~html
<iframe
  src="https://player.bilibili.com/player.html?bvid=视频BV号"
  width="560"
  height="315"
  frameborder="0"
  allowfullscreen>
</iframe>
~~~

Vimeo：

~~~html
<iframe
  src="https://player.vimeo.com/video/视频ID"
  width="560"
  height="315"
  frameborder="0"
  allowfullscreen>
</iframe>
~~~

只有上述主机及允许的属性会保留。嵌入地址应使用平台提供的播放器地址；是否正常显示还取决于平台的嵌入权限和浏览器策略。

### 6.15 HTML 表格

除 Markdown 表格外，也可以直接编写 HTML 表格：

~~~html
<table>
  <thead>
    <tr>
      <th align="left">名称</th>
      <th align="center">状态</th>
      <th align="right">数量</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="left">文章</td>
      <td align="center">已发布</td>
      <td align="right">12</td>
    </tr>
  </tbody>
</table>
~~~

表格标签及 align、valign 属性会保留。OXN 样式会让未指定对齐方式的表头和正文默认左对齐，并按单元格的 align 属性分别处理左、中、右对齐。

### 6.16 HTML 语义列表与其他文本标签

除 Markdown 列表外，还可以使用定义列表：

~~~html
<dl>
  <dt>Markdown</dt>
  <dd>轻量级标记语言。</dd>
  <dt>HTML</dt>
  <dd>用于描述网页结构的标记语言。</dd>
</dl>
~~~

HTML 语义结构标签示例：

~~~html
<article>
  <header>
    <hgroup>
      <h2>文章分区标题</h2>
      <p>副标题或补充说明</p>
    </hgroup>
  </header>
  <section>
    <p>这是文章中的一个内容分区。</p>
  </section>
  <aside>
    <p>这是与正文相关的补充说明。</p>
  </aside>
  <footer>
    <address>作者联系信息：author@example.com</address>
  </footer>
</article>
~~~

其他语义文字标签示例：

~~~html
<p><abbr title="HyperText Markup Language">HTML</abbr> 是标记语言。</p>
<p><q>这是一段短引用。</q> <cite>来源名称</cite></p>
<p><time datetime="2026-11-20">2026 年 11 月 20 日</time></p>
<p><del>旧内容</del> <ins>新增内容</ins></p>
<p>按下 <kbd>Ctrl</kbd> + <kbd>C</kbd> 复制，输出 <samp>OK</samp>。</p>
<p>变量示例：<var>x</var>；数据示例：<data value="42">四十二</data>。</p>
<p><bdi>用户名</bdi>；<bdo dir="rtl">从右向左显示</bdo>。</p>
<p><ruby>汉<rp>(</rp><rt>hàn</rt><rp>)</rp></ruby> 字音注释。</p>
<p>这一行末尾有<wbr>一个可选换行位置。</p>
~~~

### 6.17 转义字符与 HTML 实体

Markdown 中可以使用反斜杠转义特殊字符：

~~~markdown
\*这两个星号不会生成斜体\*

\# 这不会成为标题

文字中的方括号：\[示例\]
~~~

HTML 实体：

~~~html
<p>版权符号：&copy;</p>
<p>大于号：&gt;，小于号：&lt;，与符号：&amp;</p>
~~~

### 6.18 Typecho 内容标记

摘要分隔符：

~~~html
文章前半部分内容。

<!--more-->

点击阅读全文后显示的后半部分内容。
~~~

<!--more--> 用于 Typecho 文章摘要分隔；完整正文输出时不会作为可见内容显示。

Markdown 前缀：

~~~html
<!--markdown-->
# 这篇内容按 Markdown 解析

这里继续输入 Markdown 内容。
~~~

项目会识别并移除内容开头的 <!--markdown--> 标记，再处理后续正文。

## 7. 评论内容输入

评论是否允许 Markdown，取决于站点评论设置。评论表单会根据当前设置显示相应提示。

评论 Markdown 使用独立的清理规则，不能直接套用文章正文的全部 HTML 能力。评论内容允许的 HTML 范围更窄，常见支持包括链接、图片、引用、段落、列表和代码块；不应在评论中依赖视频、音频或 iframe 嵌入。

## 8. 主题样式与响应式规则

- 单栏阅读布局，正文宽度以主题变量控制。
- 文章正文图片限制在阅读栏宽度内，不再通过图片样式突破到宽屏区域。
- 正文图片采用统一的 4px 小圆角；文章图片保持在阅读栏内，表格仍可按原有规则横向展开。笔记图片网格布局保持不变。
- 代码块、表格、引用、提示块和目录均有独立样式；提示块上下间距为 `1.5em`，末尾不保留多余空白。
- 文章目录会跟随滚动更新当前标题；点击目录项展开标题文字，点击目录外区域后收起标题，只保留横线状态。
- 手机端会缩小部分字号、调整页头布局和表单排列。
- 暗黑模式通过主题颜色变量切换背景、边框、正文、弱化文字和强调色。
- 暗黑模式下标题与正文加粗文字使用统一的柔和正文颜色，避免出现过亮的纯白文字。
- 搜索弹窗、置顶/删除管理弹窗使用统一圆角风格；弹窗标题统一为 1.2rem、加粗，说明文字保持正文大小。

## 9. 插件与系统依赖边界

| 能力 | 依赖或来源 | 说明 |
| --- | --- | --- |
| 普通文章、独立页面、密码验证 | Typecho Workers 核心内容与权限流程 | 主题负责页面显示，不替代核心验证 |
| Markdown 转 HTML、文章 HTML 清理 | 项目共享 `src/lib/markdown.ts` | 全站共用，不是 OXN 私有解析器 |
| 笔记流和笔记媒体 | `typecho-plugin-notes` | 未启用时不显示笔记入口 |
| 智能摘要 | `typecho-plugin-intelligence` | 插件启用且有摘要时显示，否则使用普通摘要 |
| 评论读写和管理 | 现有评论 API、权限和站点设置 | 主题负责交互界面；文章置顶/取消置顶另由 `src/pages/api/admin/theme-pin.ts` 完成后端管理员校验、配置写入和数据库读回核验 |
| 图片优化 | 项目图片 URL 转换能力及配置的图片服务 | 主题负责提供参数和展示尺寸 |

## 10. 修改与维护原则

1. OXN 的主题样式和主题组件优先在 `src/themes/typecho-theme-oxn/` 内维护。
2. 不要把 OXN 的修改误写到原版 `typecho-theme-warm` 或其他主题目录。
3. 不要为了主题外观调整去修改核心数据库结构、文章存储或权限逻辑。
4. 笔记流的核心入口兼容条件属于已知的必要路由例外；除非确认替代方案，不要随意删除，否则笔记专属入口可能在主题组件运行前被核心路由判为 404。
5. Markdown 解析和 HTML 清理属于共享核心流程。若要扩大所有文章可用的 HTML 标签或嵌入协议，应先评估全站安全影响，不要在主题中假设可以绕过清理。
6. 修改后台配置字段时，应同步检查 `theme.json`、`components/warm.ts` 的读取逻辑和实际前台使用位置。
7. 修改加载模式时，应区分内容列表、评论组件和评论列表三套设置，不要混为一个开关。
8. 修改管理员操作按钮时，必须保留后端权限校验；前台隐藏按钮不代表撤销权限。
9. 主题设置备份是手动导出/导入机制，升级或切换主题前请自行保留 JSON 备份。

---

**文档维护说明：** 本文件描述的是当前 OXN 源码中能够确认的行为。项目核心路由、共享 Markdown 清理配置或插件接口发生变化时，应同步复核本文对应章节，避免把历史行为误写成当前功能。


## 11. 主题设置与数据备份优化（分支 25）

本节补充分支 `25` 对 OXN 主题设置管理和首页置顶数据所做的优化。若本节与前文关于首页置顶 ID 保存方式或设置备份范围的描述存在差异，以本节对应的分支 25 实现为准。

### 11.1 首页置顶 ID 独立管理

- 首页置顶文章 CID 使用独立的数据库 option（`theme-pin:typecho-theme-oxn`）保存，不再作为普通主题设置值参与常规主题配置保存。
- 主题设置页面可以读取当前置顶 CID，并通过独立的保存入口批量替换置顶列表。
- 批量保存会校验 CID 格式、去重，并检查对应内容是否为已发布的普通文章。
- 保存后更新首页缓存，并从数据库重新读取结果进行核验。
- 评论区管理员的单篇置顶/取消置顶仍使用专用置顶 API；该操作原有的确认要求和权限校验不因主题设置页面的调整而改变。

### 11.2 设置导出与导入

- OXN 主题设置支持导出为 JSON 文件，用于备份和迁移。
- 导出时会排除独立管理的首页置顶 ID（`pinnedIds`），避免将置顶数据混入普通主题设置备份。
- 导入功能用于恢复普通主题设置；首页置顶列表应在置顶 ID 独立管理区域另行查看和维护。
- 建议在切换主题或进行较大范围设置调整前，先通过“导出设置”保存一份 JSON 备份。

### 11.3 保存主题设置时的提醒

点击常规主题设置的保存按钮时，会先显示浏览器确认提示，提醒管理员：

- 保存主题设置后存在 60 秒冷却时间。
- 保存前请确认所有设置内容无误。
- 建议先通过“导出设置”备份，以便切换主题后恢复。

该提示只针对常规主题设置的保存操作，不代表首页置顶 CID 独立保存也会触发主题设置的 60 秒冷却提示。

### 11.4 设置字段长度与导出范围

- 当前 OXN 主题设置界面的自定义文本输入框和文本域没有人为设置的字符长度上限（未设置 `maxlength`）。
- 设置导出过程不会主动按字符数限制字段，也不会主动截断字段内容。
- 设置导入过程不会主动截断字段内容。
- 以上表示当前实现没有额外设置字段长度限制，不代表浏览器、HTTP 请求、运行环境或数据库不存在容量限制。



## 12. 相对上游 Tokinx/typecho-workers 的核心文件修改

本节对比对象是上游仓库 `Tokinx/typecho-workers` 的 `master`，不是本仓库自己的 `master` 分支。以下列出 OXN 当前维护版本中，相对上游原版实际存在差异的系统核心文件，以及增加或调整的内容。

### 12.1 `src/pages/index.astro`：首页入口兼容

相对上游，修改了笔记流入口判断：

- 上游判断条件针对 `typecho-theme-warm`。
- 当前版本将该判断条件调整为 `typecho-theme-oxn`。
- 作用是让 OXN 主题进入已有的笔记流首页处理路径，避免 OXN 的笔记/混合时间流没有普通文章列表时，在进入主题组件前被系统首页入口提前判定为空并返回 404。
- 这是对既有分支入口判断的主题适配，不是置顶功能所需的修改。

**影响范围：** 系统首页路由对 OXN 笔记流的分发判断；没有因此增加新的公共 API。

### 12.2 `src/lib/markdown.ts`：扩展 Markdown/HTML 清理白名单

这是核心文件中改动内容最多的一项。相对上游，增加或扩展了以下内容：

1. **HTML 标签白名单**
   - 增加常用结构标签，例如 `section`、`article`、`main`、`header`、`footer`、`nav`、`aside`。
   - 增加文本语义标签，例如 `small`、`mark`、`abbr`、`time`、`sub`、`sup`。
   - 增加表单相关标签，例如 `form`、`fieldset`、`input`、`select`、`option`、`textarea`、`button`、`label`。
   - 增加完整 SVG 绘制所需的标签，例如 `svg`、`path`、`g`、`circle`、`rect`、`linearGradient`、`filter`、`mask`、`clipPath` 等。

2. **通用 HTML 属性白名单**
   - 增加通用的 `class`、`id`、`title`、`style`、`role`、`aria-*`、`data-*` 属性支持。
   - 链接增加 `download` 属性。
   - iframe 增加 `allow`、`sandbox`、`loading`、`referrerpolicy`。
   - video 增加 `poster`；source 增加 `srcset`、`sizes`、`media`。
   - 为新增表单标签分别增加对应属性白名单。

3. **SVG 属性白名单**
   - 为 SVG 图形、路径、渐变、遮罩、裁剪、滤镜、文字等元素增加对应属性。
   - 支持常见的填充、描边、透明度、变换、渐变、路径和文字排版属性。
   - 保留 SVG 标签大小写解析，避免 SVG 驼峰标签名被错误处理。

4. **受限内联样式**
   - 增加 `allowedStyles` 规则，支持颜色、背景、字体、布局、定位、尺寸、边距、内边距、边框、阴影、溢出和对齐等样式属性。
   - 样式值通过规则过滤，明确拦截包含 `url(`、`expression(`、`javascript:`、`@import`、`behavior:`、`-moz-binding` 等危险内容的值。
   - SVG 的填充、描边和透明度等属性也有相应值规则。

5. **图片尺寸参数处理**
   - 增加对图片 URL 中 `width`、`height` 参数的识别。
   - 参数值在 1 至 16384 范围内时，将尺寸转换为图片元素的宽高属性，并从图片 URL 查询参数中清理对应尺寸参数。
   - 不符合范围的尺寸不会按该规则转换。

6. **iframe 主机白名单**
   - 在原有 YouTube、Bilibili 播放器和 Vimeo 主机基础上，增加 `www.bilibili.com`。
   - iframe 主机仍然受 `allowedIframeHostnames` 白名单约束，并非允许任意外部网站嵌入。

**作用：** 让文章、独立页面和笔记正文可以使用更多结构化 HTML、SVG、受限内联样式、表单元素及媒体嵌入，同时继续经过清理白名单控制。

### 12.3 `src/lib/security-headers.ts`：CSP 与 iframe 白名单配套

相对上游，CSP 的 `frame-src` 增加：

- `https://www.bilibili.com`

该项与 `markdown.ts` 中增加的 Bilibili 主机白名单配套。前者决定浏览器 CSP 是否允许页面加载该来源的 iframe，后者决定 Markdown/HTML 清理是否允许该主机进入 iframe 的 src。两处需要保持一致，否则即使内容清理通过，也可能被浏览器 CSP 拦截。

### 12.4 `astro.config.mjs`：Vite workspace 依赖优化排除项

相对上游，在 Vite 的 `optimizeDeps.exclude` 中增加：

- `typecho-plugin-wordpress-import`

该插件 workspace 包需要保持源码路径加载，避免被依赖预打包流程处理。此项属于构建/开发环境的 workspace 依赖解析配置，不是 OXN 前台页面功能代码。

### 12.5 `package.json`：增加 workspace 依赖声明

相对上游，增加或补充以下依赖：

- `typecho-plugin-core-download: workspace:*`
- `typecho-plugin-pinyin: workspace:*`
- `typecho-theme-oxn: workspace:*`
- `typecho-plugin-wordpress-import: workspace:*`
- `fast-xml-parser: ^5.10.1`

这些声明使根项目能够解析对应的本地插件、主题 workspace 和 XML 解析依赖。它们属于项目依赖清单，不是单独的运行时路由改动。

### 12.6 `bun.lock`：依赖锁定同步

- 与 `package.json` 的 workspace 依赖变化保持同步。
- 锁定新增的 OXN 主题、相关插件 workspace 和 `fast-xml-parser` 等依赖解析结果。
- 文件中还包含对应依赖树和包版本、完整性信息的变化。
- 部署或安装时应与 `package.json` 一起同步，不能只复制依赖清单而遗漏锁文件。

### 12.7 核心文件与 OXN 置顶功能的关系

| 核心文件 | 主要用途 | 是否由本次置顶独立存储改动引起 |
| --- | --- | --- |
| `src/pages/index.astro` | OXN 笔记流入口兼容 | 否，历史主题入口适配 |
| `src/lib/markdown.ts` | HTML/SVG/样式/媒体清理白名单扩展 | 否，内容渲染能力扩展 |
| `src/lib/security-headers.ts` | Bilibili iframe 的 CSP 来源许可 | 否，与内容嵌入白名单配套 |
| `astro.config.mjs` | workspace 依赖预优化排除 | 否，构建配置 |
| `package.json` | 主题和插件 workspace 依赖声明 | 否，项目依赖配置 |
| `bun.lock` | 依赖版本和解析结果锁定 | 否，依赖锁定 |

以上文件是相对上游原版的历史/既有核心差异，部署包含这些功能的当前版本时应按同一维护版本同步；但不能把它们描述成 25 分支本次置顶独立存储功能新增的文件。

### 12.8 本次 25 分支置顶功能的独立改动范围

本次置顶独立存储功能涉及的代码文件是：

- `src/pages/api/admin/theme-pin.ts`
- `src/themes/typecho-theme-oxn/components/Index.astro`
- `src/themes/typecho-theme-oxn/theme.json`

它们负责独立置顶 option 的读写、首页读取展示，以及主题设置页的批量管理和备份行为。上述第 12.1 至 12.6 节的核心文件修改属于其他既有功能，不应与本次置顶改动混为一谈。
