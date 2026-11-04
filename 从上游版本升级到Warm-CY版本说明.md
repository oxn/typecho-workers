# 从上游版本升级到 Warm CY 版本说明

**适用仓库：** `xoxx/typecho-workers`  
**目标版本来源：** `oxn/typecho-workers`  
**对照基准：**

- 上游备用仓库：`6f268808f4f510852887f18cf43fd88567d69e15`
- 当前功能仓库：`784a7cef8a4527bc44c56184a545acba65f3a16e`
- 对照日期：2026-11-04

本文用于将保留上游核心程序的备用项目，增量升级为包含 Warm CY 主题及配套插件的版本。升级采用**新增主题/插件文件夹，并同步必要的根目录构建配置**的方式，不建议直接用整个功能仓库覆盖备用仓库。

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

不要只复制主题入口文件或 CSS；组件、资源和主题配置都属于主题完整组成部分。

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

该插件是 Warm CY 主题的配套插件，提供主题配套 API、置顶管理、评论区操作及首页搜索显示设置等功能。使用 Warm CY 主题时，应同时保留并启用该配套插件。

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

以下三个文件必须使用目标版本（`oxn/typecho-workers`）对应版本替换备用仓库中的同名文件：

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

## 二、建议一并复制的说明和测试文件

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

如果本次只想完成最小运行升级，可以暂不复制本节文件；但建议保留项目文档。

---

## 三、构建时生成的公共主题资源

目标版本仓库中还存在以下构建产物：

```text
public/themes/typecho-theme-warm-cy/
public/themes/typecho-theme-warm/style.css
```

这些文件由主题加载器在构建阶段根据 `src/themes/` 中的主题包复制或生成。正常构建时会处理这些资源，因此**通常不需要手动复制 `public/themes/` 下的文件**。

不要把构建产物当成主题源文件；真正需要维护的是前面列出的 `src/themes/typecho-theme-warm-cy/`。

---

## 四、不要覆盖的内容

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
- 不覆盖原有缓存插件的程序代码；本次差异中的缓存插件内容仅有一份补充说明文档。
- 不覆盖原有 Warm 主题。
- 不覆盖 `.dev.vars`、Wrangler/Cloudflare 环境变量、D1/KV 绑定或数据库配置。
- 不要删除备用仓库中原有的文件或目录。

本次两个仓库的文件对照中，没有发现目标版本删除备用仓库原有文件的情况；除上述三个新增目录及说明资料外，根目录构建配置有差异，另有一份 Markdown 单元测试文件发生修改。

---

## 五、推荐操作顺序

1. 先备份 `xoxx/typecho-workers` 当前仓库，尤其是本地环境变量、Wrangler 配置和数据库相关配置。
2. 在备用仓库中新增 `src/themes/typecho-theme-warm-cy/`。
3. 新增 `src/plugins/typecho-plugin-warm-cy/`。
4. 新增 `src/plugins/typecho-plugin-pinyin/`。
5. 用目标版本替换 `astro.config.mjs`、`package.json`、`bun.lock`。
6. 按需复制第二节列出的说明和测试文件。
7. 检查文件路径和大小写，确保没有把文件放错目录，也没有误覆盖原有核心文件。
8. 安装依赖并执行项目构建、测试。
9. 本地验证主题切换、CY 配套插件设置、搜索入口、拼音别名等功能后，再决定是否部署。

---

## 六、版本来源与文件核对

目标功能仓库：

https://github.com/oxn/typecho-workers

备用上游仓库：

https://github.com/xoxx/typecho-workers

目标主题目录：

https://github.com/oxn/typecho-workers/tree/master/src/themes/typecho-theme-warm-cy

目标 CY 配套插件：

https://github.com/oxn/typecho-workers/tree/master/src/plugins/typecho-plugin-warm-cy

目标拼音插件：

https://github.com/oxn/typecho-workers/tree/master/src/plugins/typecho-plugin-pinyin

> 本文是基于 2026-11-04 两个仓库当时的 master 文件树和提交差异整理的升级指南。若两个仓库后续继续更新，执行升级前应重新比较最新提交，不能把本文中的版本号当作永久不变的最新版本。

**升级原则：保留上游核心，增量加入 Warm CY 主题与配套插件；不整仓覆盖，不擅自改动数据库或 Cloudflare 运行配置。**
