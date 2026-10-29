# typecho-theme-warm-cy 修改与上游升级记录

## 目标与边界

- 本主题是 `typecho-theme-warm` 的独立副本，主题 ID 为 `typecho-theme-warm-cy`。
- 所有功能改动限定在 `src/themes/typecho-theme-warm-cy/`。
- 不修改原主题 `src/themes/typecho-theme-warm/`。
- 本交付包不包含根目录 `package.json`、`astro.config.mjs` 或任何核心源码修改。用户已验证本地新增主题目录可以被发现并显示；因此先按纯主题目录方案交付。

## 修改文件与作用

### `theme.json`
- 将主题 ID/name 改为 `typecho-theme-warm-cy` / `Typecho Warm CY`。
- 删除原主题的 GitHub 地址、社交主页地址、联系邮箱设置项。
- 增加 `pinnedIds` 首页置顶文章 ID 配置。
- 增加 `linktxt01` 至 `linktxt10`（链接文字）、`links01` 至 `links10`（链接地址）、`linkblank01` 至 `linkblank10`（是否新窗口打开）。
- 原主题的其他设置尽量保留。

### `package.json`
- 主题包名使用 `typecho-theme-warm-cy`，关键词包含 `typecho` 和 `theme`，供项目主题发现机制识别。

### `components/warm.ts`
- `WARM_THEME_ID` 改为 `typecho-theme-warm-cy`，读取独立主题配置。
- 解析 `pinnedIds`，支持英文/中文逗号及空白分隔，过滤无效 ID、重复 ID。
- 读取 10 组自定义链接及每项新窗口开关；只接受 HTTP/HTTPS URL。

### `components/Index.astro`
- 首页列表根据主题设置中的 ID 从数据库单独查询已发布、非未来文章。
- 置顶显示顺序按照设置中 ID 的顺序。
- 首页第一页展示置顶文章。
- 首页普通文章流和后续页排除置顶 ID，避免“加载更多”重复显示。
- 置顶文章补齐文章链接、摘要和分类信息。

### `components/WarmShell.astro`
- 页脚保留 RSS。
- 移除 GitHub、社交主页、邮箱旧链接输出。
- 渲染配置中有效的自定义文字链接。
- 勾选新窗口时设置 `target="_blank"` 和 `rel="noopener noreferrer"`；未勾选则在当前窗口打开。

## 配置键清单

- 首页置顶：`pinnedIds`
- 文字：`linktxt01` … `linktxt10`
- URL：`links01` … `links10`
- 新窗口开关：`linkblank01` … `linkblank10`

## 当前验证状态

- 已静态检查配置键和主题 ID。
- 已确认本包只包含 `src/themes/typecho-theme-warm-cy/`，没有根目录文件。
- 当前运行环境没有安装项目依赖，尚未执行 Astro 构建，也未对真实 D1 数据执行浏览器端回归测试；不能将构建/运行验证标记为通过。

## 原版升级后的移植步骤

1. 更新上游原主题到 `src/themes/typecho-theme-warm/`，不要直接覆盖本目录。
2. 对照新版本复制更新过的通用组件、样式及功能文件到本主题。
3. 保留本主题的 `theme.json` 独立 ID 与新增配置项；若上游更新设置项，需要把新增项合并进本主题配置。
4. 保留 `components/warm.ts` 的独立 `WARM_THEME_ID`，并检查上游对 `loadThemeConfig`、配置结构的改动。
5. 合并 `components/Index.astro` 的上游更新时，重新核对置顶查询、首页第一页显示、普通/混合内容流过滤以及分页 URL。
6. 合并 `components/WarmShell.astro` 时，保留 RSS、动态页脚链接和新窗口属性，确认不再输出 GitHub、社交主页、邮箱旧配置。
7. 运行项目原有构建命令；在测试环境验证首页、`?stream=posts`、混合笔记流、分类/归档、加载更多、10 组链接与新窗口开关。
8. 更新本文件，记录本次上游版本、重新移植的文件、冲突和验证结果。

## 已知注意事项

- 当前置顶实现依赖项目现有 `contents`、`relationships`、`metas` 数据结构和 `typecho/db` 导出，不创建额外数据表。
- 置顶文章 ID 必须对应已发布的文章；不存在、草稿或未来文章会被忽略。
- 本方案只承诺首页置顶；分类、归档和笔记专属页面不受置顶设置影响。
- 本文记录的是本次源码变更意图，不代表尚未执行的构建或线上验证已成功。
