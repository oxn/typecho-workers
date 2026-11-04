# 从上游版本升级到 Warm CY 版本说明

**适用仓库：** `xoxx/typecho-workers`（保留上游核心的备用仓库）  
**目标仓库：** `oxn/typecho-workers`  
**本次功能分支：** `feature/cy-inline-html-enhancement-20261104`

**本次核对基准：**
- 上游备用仓库基准提交：`6f268808f4f510852887f18cf43fd88567d69e15`
- 目标仓库 master 基线：`58d92ea9055b307d48e96ed5ce1c35d5df630d32`
- 当前功能分支提交：`55c83e4aacf71e1e4b20d552140dec334518c0af`
- 对照日期：2026-11-04

本文用于将保留上游核心程序的备用项目，增量升级为包含 Warm CY 主题及配套插件的版本。升级采用**新增主题/插件目录，并同步必要的根目录构建配置**的方式，不建议直接用整个功能仓库覆盖备用仓库。

> 本文中的提交号是本次整理时的核对基准，不代表以后永远是最新版本。每次升级前都应重新核对目标分支。

---

## 一、必须新增或替换的内容

### 1. 新增 Warm CY 主题

将整个目录复制到备用仓库对应位置：

```text
src/themes/typecho-theme-warm-cy/
```

请保留目录内全部文件和子目录，包括：

- `theme.json`
- `package.json`
- `style.css`
- `screenshot.png`
- `assets/`
- `components/`
- `docs/`

其中 `assets/` 包含主题使用的图标资源。本次功能分支已更新：

- `assets/favicon.ico`
- `assets/favicon.svg`

复制主题时应复制整个目录，不要只替换其中一个图标文件，以免遗漏主题的其他资源。

### 2. 新增 CY 主题功能插件

将整个目录复制到：

```text
src/plugins/typecho-plugin-warm-cy/
```

保留目录内全部文件，包括：

- `index.ts`
- `package.json`
- `admin.css`
- `assets.d.ts`
- `index.test.ts`

该插件是 Warm CY 主题的配套插件，提供主题配套 API、置顶管理、评论区操作、首页搜索显示设置，以及正文 HTML 增强功能。使用 Warm CY 主题时，应同时保留并启用该配套插件。

### 3. 新增拼音别名插件

将整个目录复制到：

```text
src/plugins/typecho-plugin-pinyin/
```

保留目录内全部文件，包括：

- `index.ts`
- `package.json`
- `README.md`
- `index.test.ts`

该插件为文章和独立页面编辑器提供拼音网址别名建议。

### 4. 同步三个根目录配置文件

以下三个文件必须使用目标版本对应版本替换备用仓库中的同名文件：

```text
astro.config.mjs
package.json
bun.lock
```

它们的作用分别是：

- `astro.config.mjs`：将新增主题和插件加入构建期依赖排除配置，避免工作区包被错误预打包。
- `package.json`：注册 `typecho-theme-warm-cy`、`typecho-plugin-warm-cy`、`typecho-plugin-pinyin` 等工作区依赖。
- `bun.lock`：锁定新增工作区及拼音插件依赖（包括 `pinyin-pro`）。

**注意：三个文件要成套同步。** 不能只改 `package.json` 而遗漏 `bun.lock`，也不能只复制主题和插件目录而不注册工作区依赖。

---

## 二、当前功能分支新增和完善的功能

以下内容是目标仓库当前功能分支相对于 master 基线增加的内容。升级时应使用该分支中的完整插件和主题目录，不要只挑选单个代码片段复制。

### 1. 正文 HTML / CSS / JavaScript 增强（可选开启）

CY 配套插件设置页增加了 **“正文 HTML / CSS / JavaScript 增强”** 开关。

开启后，文章、笔记和独立页面正文可使用内嵌：

- HTML 的 `class`、`id`、`data-*`、`aria-*` 和 `style` 属性；
- `<style>` 样式块；
- `<script>` 脚本块；
- SVG 图标及其常见图形元素。

插件会在 Markdown 处理和核心 HTML 清理流程前后保护、恢复相关内容，并对恢复的 HTML/SVG 做允许范围内的处理。代码围栏和行内代码示例仍应作为代码显示，不应被当成可执行内容。

**安全提醒：** 开启后，正文中的脚本会在访客浏览器中执行。只应允许可信任的管理员或作者发布此类内容；不要把该开关理解为可以安全执行任意访客提交的 HTML/JavaScript。评论区不受此功能影响。

### 2. 完整 HTML 片段及样式恢复修复

本分支修复了内嵌 HTML、CSS、SVG 内容经过保护和恢复时，代码片段占位标记可能残留在样式表中的问题。相关回归测试覆盖样式块中的 CSS 规则及标记清理。

这项修复用于避免出现 HTML 元素能够显示、但字号、字体、圆角等 CSS 属性没有按正文样式生效的情况。

### 3. Warm CY 主题 favicon 更新

本分支替换了以下两个主题图标资源：

```text
src/themes/typecho-theme-warm-cy/assets/favicon.ico
src/themes/typecho-theme-warm-cy/assets/favicon.svg
```

更新主题时应一并复制这两个文件。浏览器可能缓存旧 favicon；替换后若暂时仍显示旧图标，可清理/刷新站点缓存并强制刷新浏览器，再判断是否更新成功。

### 4. CY 插件版本信息

CY 插件设置页会显示插件构建版本。版本号由插件自己的版本字段维护，与主题版本独立。

后续维护遵循以下规则：

- 只修改 CY 插件时，只更新插件版本号；
- 只修改 Warm CY 主题时，只更新主题版本号；
- 插件和主题都修改时，分别更新各自版本号；
- 仅修改说明文档或其他无关文件时，不更新插件/主题版本号；
- 版本格式统一为 `YYYY.MM.DD.HH.MM`。

---

## 三、建议一并复制的说明和测试文件

以下内容不属于线上运行的必要代码，但建议随项目一并保留，便于后续维护和核对：

```text
.github/workflows/branch-validation.yml
docs/UPSTREAM-BASELINE.md
docs/WARM-CY-MIGRATION-MAP.md
src/plugins/typecho-plugin-cache/重要必看插件修改补充说明20261031版README.md
tests/unit/markdown.test.ts
更新说明2026年11月03日20时31分.md
更新说明2026年11月04日16时20分.md
```

其中：

- `tests/unit/markdown.test.ts` 是测试文件，不是线上运行必需文件。
- `.github/workflows/branch-validation.yml` 是仓库分支验证工作流，不是网站运行代码。
- `docs/`、README 和更新说明用于记录项目来源、迁移关系及维护事项。

如果本次只想完成最小运行升级，可以暂不复制本节文件；但建议保留项目文档。若目标分支后来增加了新的更新说明文件，请以目标分支实际文件为准，不要删除备用仓库已有说明。

---

## 四、构建时生成的公共主题资源

目标版本仓库中还存在以下构建产物：

```text
public/themes/typecho-theme-warm-cy/
public/themes/typecho-theme-warm/style.css
```

这些文件由主题加载器在构建阶段根据 `src/themes/` 中的主题包复制或生成。正常构建时会处理这些资源，因此**通常不需要手动复制 `public/themes/` 下的文件**。

不要把构建产物当成主题源文件；真正需要维护的是前面列出的 `src/themes/typecho-theme-warm-cy/`。

---

## 五、不要覆盖的内容

本次是增量升级，不是整仓替换。请保留备用仓库原有的核心程序和运行环境配置。

特别不要用目标仓库文件覆盖以下内容：

```text
src/lib/
src/pages/
src/db/
src/middleware.ts
src/integrations/
src/plugins/typecho-plugin-cache/
src/themes/typecho-theme-warm/
```

说明：

- 不覆盖 `src/lib/`、`src/pages/`、`src/db/`、`src/middleware.ts` 等核心程序源码。
- 不覆盖原有缓存插件的程序代码；如需保留缓存插件的补充说明文档，只复制文档，不替换缓存插件本身。
- 不覆盖原有 Warm 主题。
- 不覆盖 `.dev.vars`、Wrangler/Cloudflare 环境变量、D1/KV 绑定或数据库配置。
- 不要删除备用仓库中原有的文件或目录。
- 不要把本次升级理解为整仓覆盖，也不要为了适配主题而修改上游核心文件或后台核心页面。

本次功能分支相对于目标仓库 master 基线的代码变更范围为 CY 配套插件的实现、测试和版本元数据，以及 Warm CY 主题的两个 favicon 资源；没有修改上游核心程序、主后台页面或缓存插件代码。

---

## 六、推荐操作顺序

1. 先备份 `xoxx/typecho-workers` 当前仓库，尤其是本地环境变量、Wrangler 配置和数据库相关配置。
2. 在备用仓库中新增 `src/themes/typecho-theme-warm-cy/`。
3. 新增 `src/plugins/typecho-plugin-warm-cy/`。
4. 新增 `src/plugins/typecho-plugin-pinyin/`。
5. 用目标版本替换 `astro.config.mjs`、`package.json`、`bun.lock`。
6. 按需复制第三节列出的说明和测试文件。
7. 检查文件路径和大小写，确保没有把文件放错目录，也没有误覆盖原有核心文件。
8. 安装依赖并执行项目构建、测试。
9. 本地验证主题切换、CY 配套插件设置、首页搜索、拼音别名、正文 HTML/CSS/SVG/JavaScript 增强及 favicon 显示。
10. 确认版本更新后，刷新缓存插件，再检查前台页面。若 favicon 仍显示旧图标，再强制刷新浏览器缓存。
11. 本地验证通过后，再决定是否部署；构建成功不等于 Cloudflare 生产环境已经部署成功。

---

## 七、版本来源与文件核对

目标功能仓库：

https://github.com/oxn/typecho-workers

本次功能分支：

https://github.com/oxn/typecho-workers/tree/feature/cy-inline-html-enhancement-20261104

备用上游仓库：

https://github.com/xoxx/typecho-workers

目标主题目录：

https://github.com/oxn/typecho-workers/tree/feature/cy-inline-html-enhancement-20261104/src/themes/typecho-theme-warm-cy

目标 CY 配套插件：

https://github.com/oxn/typecho-workers/tree/feature/cy-inline-html-enhancement-20261104/src/plugins/typecho-plugin-warm-cy

目标拼音插件：

https://github.com/oxn/typecho-workers/tree/master/src/plugins/typecho-plugin-pinyin

> 本文根据 2026-11-04 的仓库文件和提交差异整理。上游仓库、master 和功能分支后续都可能继续更新；每次执行升级前，应重新比较最新提交和文件差异，不能把本文中的提交号当作永久不变的最新版本。

**升级原则：保留上游核心，增量加入 Warm CY 主题与配套插件；不整仓覆盖，不擅自改动核心文件、数据库或 Cloudflare 运行配置。**
