# typecho-theme-warm-cy v7：相对原版主题逐文件变更档案

## 1. 版本说明

- 基准原版目录：`src/themes/typecho-theme-warm/`。
- 自定义主题目录：`typecho-theme-warm-cy/`。
- 本档案根据当前工作目录中的实际文件逐一比较生成，不以口头功能描述代替文件差异。
- 页脚 CSS：`style.css` 中与原版相同的页脚样式规则保持原样；本次只保留自定义主题已有的置顶徽标样式，不改动页脚布局。
- ZIP 只打包主题目录，不包含项目根目录或其他项目文件。

## 2. 文件差异总览

| 状态 | 文件 | 说明 |
|---|---|---|
| 未变 | `components/Archive.astro` | 与原版内容一致 |
| 修改 | `components/Index.astro` | 相对原版存在内容差异 |
| 未变 | `components/NotFound.astro` | 与原版内容一致 |
| 未变 | `components/Page.astro` | 与原版内容一致 |
| 未变 | `components/Post.astro` | 与原版内容一致 |
| 未变 | `components/WarmCommentList.astro` | 与原版内容一致 |
| 未变 | `components/WarmComments.astro` | 与原版内容一致 |
| 未变 | `components/WarmNoteMedia.astro` | 与原版内容一致 |
| 修改 | `components/WarmShell.astro` | 相对原版存在内容差异 |
| 未变 | `components/WarmStreamPagination.astro` | 与原版内容一致 |
| 未变 | `components/WarmToc.astro` | 与原版内容一致 |
| 未变 | `components/instantclick.ts` | 与原版内容一致 |
| 未变 | `components/viewimage.ts` | 与原版内容一致 |
| 修改 | `components/warm.ts` | 相对原版存在内容差异 |
| 新增 | `docs/UPGRADE-NOTES.md` | 仅存在于自定义主题 |
| 修改 | `package.json` | 相对原版存在内容差异 |
| 修改 | `style.css` | 相对原版存在内容差异 |
| 修改 | `theme.json` | 相对原版存在内容差异 |

## 3. 逐文件差异明细

差异块中 `-` 表示原版内容，`+` 表示自定义主题内容；上下文行用于定位修改位置。新增文件列出完整内容。

### `components/Archive.astro`

**状态：未修改，与原版文件逐字节一致。**

### `components/Index.astro`

**状态：已修改；以下为完整 unified diff。**

```diff
--- 原版/components/Index.astro
+++ 自定义/components/Index.astro
@@ -4,9 +4,10 @@
 import { getNotesStreamForTheme, type NoteListItem } from 'typecho-plugin-notes';
 import { createContext } from '@/lib/context';
 import { optimizeContentImages } from '@/lib/image-transform';
-import { and, eq, inArray } from 'drizzle-orm';
+import { and, eq, inArray, lte } from 'drizzle-orm';
 import type { ThemeIndexProps, PostListItem } from '@/lib/theme-props';
-import { buildCategoryLink } from '@/lib/content';
+import { buildCategoryLink, buildPermalink } from '@/lib/content';
+import { renderContentExcerpt } from '@/lib/markdown';
 import NotFound from './NotFound.astro';
 import WarmShell from './WarmShell.astro';
 import WarmStreamPagination from './WarmStreamPagination.astro';
@@ -127,6 +128,72 @@
 const heading = stream === 'notes' ? '笔记' : stream === 'posts' ? '文章' : '';
 const settings = warmSettings(options);
 const baseUrl = `${urls.siteUrl.replace(/\/$/, '')}/`;
+
+// 首页置顶来自本主题的独立外观配置。直接按 ID 查询数据库，不能只在当前页 posts 上排序，
+// 否则原本位于后续页的文章无法出现在首页顶部。
+const isHomeListing = Astro.url.pathname === '/' && !topic && !requestedStream;
+const isHomepage = isHomeListing && pagination.currentPage === 1;
+const pinnedIds = isHomeListing ? settings.pinnedIds : [];
+const pinnedIdSet = new Set(pinnedIds);
+let pinnedItems: WarmPostItem[] = [];
+if (pinnedIds.length > 0) {
+  const pinDb = getDb(env.DB);
+  const now = Math.floor(Date.now() / 1000);
+  const pinnedRows = await pinDb.select({
+    cid: schema.contents.cid,
+    title: schema.contents.title,
+    slug: schema.contents.slug,
+    created: schema.contents.created,
+    text: schema.contents.text,
+    type: schema.contents.type,
+    status: schema.contents.status,
+  }).from(schema.contents).where(and(
+    inArray(schema.contents.cid, pinnedIds),
+    eq(schema.contents.type, 'post'),
+    eq(schema.contents.status, 'publish'),
+    lte(schema.contents.created, now),
+  ));
+  const rowById = new Map(pinnedRows.map(row => [Number(row.cid), row]));
+  const validIds = pinnedIds.filter(cid => rowById.has(cid));
+  const categoryById = new Map<number, PostListItem['categories']>();
+  if (validIds.length > 0) {
+    const categoryRows = await pinDb.select({
+      cid: schema.relationships.cid,
+      mid: schema.metas.mid,
+      name: schema.metas.name,
+      slug: schema.metas.slug,
+    }).from(schema.relationships)
+      .innerJoin(schema.metas, eq(schema.relationships.mid, schema.metas.mid))
+      .where(and(inArray(schema.relationships.cid, validIds), eq(schema.metas.type, 'category')));
+    for (const row of categoryRows) {
+      const cid = Number(row.cid);
+      const categories = categoryById.get(cid) || [];
+      categories.push({
+        name: row.name || '',
+        slug: row.slug || '',
+        permalink: buildCategoryLink(row.slug || '', urls.siteUrl, options.categoryPattern as string | undefined, row.mid),
+      });
+      categoryById.set(cid, categories);
+    }
+  }
+  pinnedItems = validIds.map(cid => {
+    const row = rowById.get(cid)!;
+    return {
+      type: 'post' as const,
+      cid,
+      title: row.title || '',
+      permalink: buildPermalink({ cid, slug: row.slug, type: row.type, created: row.created }, urls.siteUrl, options.permalinkPattern as string | undefined),
+      excerpt: plainExcerpt(renderContentExcerpt(row.text || '', ' - 阅读剩余部分 -', buildPermalink({ cid, slug: row.slug, type: row.type, created: row.created }, urls.siteUrl, options.permalinkPattern as string | undefined))),
+      created: Number(row.created || 0),
+      categories: categoryById.get(cid) || [],
+    };
+  });
+}
+// 排除所有页普通/混合流中的置顶文章，防止加载更多时重复；第一页再按设置顺序置顶。
+items = items.filter(item => item.type !== 'post' || !pinnedIdSet.has(Number(item.cid)));
+if (isHomepage && currentPage === 1 && pinnedItems.length > 0) {
+  items = [...pinnedItems, ...items];
+}
 const pageUrl = (page: number) => {
   const params = new URLSearchParams();
   if (stream !== 'mixed') params.set('stream', stream);
@@ -196,6 +263,7 @@
           <time datetime={new Date(item.created * 1000).toISOString()}>{formatWarmDate(item.created, options.postDateFormat, options.timezone)}</time>
           {item.categories[0] ? <span aria-hidden="true">·</span> : null}
           {item.categories[0] ? <a class="warm-category" href={item.categories[0].permalink}>{item.categories[0].name}</a> : null}
+          {isHomepage && pinnedIdSet.has(Number(item.cid)) && <span class="warm-pinned-badge" aria-label="置顶文章"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2.5h6l-.7 3.1 2.2 2.2v1H8.8v4.7l-.8.8-.8-.8V8.8H3.5v-1l2.2-2.2L5 2.5Z" fill="currentColor"/></svg>置顶</span>}
         </div>
         <h2><a href={item.permalink}>{item.title}</a></h2>
         {item.excerpt && <p>{item.excerpt}</p>}
```

### `components/NotFound.astro`

**状态：未修改，与原版文件逐字节一致。**

### `components/Page.astro`

**状态：未修改，与原版文件逐字节一致。**

### `components/Post.astro`

**状态：未修改，与原版文件逐字节一致。**

### `components/WarmCommentList.astro`

**状态：未修改，与原版文件逐字节一致。**

### `components/WarmComments.astro`

**状态：未修改，与原版文件逐字节一致。**

### `components/WarmNoteMedia.astro`

**状态：未修改，与原版文件逐字节一致。**

### `components/WarmShell.astro`

**状态：已修改；以下为完整 unified diff。**

```diff
--- 原版/components/WarmShell.astro
+++ 自定义/components/WarmShell.astro
@@ -35,12 +35,10 @@
 const categories = sidebarData.categories.slice(0, 8);
 const homeUrl = `${urls.siteUrl.replace(/\/$/, '')}/`;
 const notesEnabled = pluginCtx.activatedPlugins.has('typecho-plugin-notes');
-const socialLinks = [
-  { label: 'RSS', href: urls.feedUrl },
-  { label: 'GitHub', href: settings.githubUrl },
-  { label: '社交主页', href: settings.socialUrl },
-  { label: 'Email', href: settings.email ? `mailto:${settings.email}` : '' },
-].filter(link => link.href);
+const footerLinks = [
+  ...settings.footerLinks.map(link => ({ label: link.text, href: link.url, newWindow: link.newWindow })),
+  { label: 'RSS', href: urls.feedUrl, newWindow: false },
+];
 ---
 <Base
   title={title}
@@ -94,7 +92,7 @@
         {options.description && <><span aria-hidden="true">·</span><span class="warm-footer__tagline">{options.description}</span></>}
       </div>
       <nav aria-label="页脚链接">
-        {socialLinks.map(link => <a href={link.href}>{link.label}</a>)}
+        {footerLinks.map(link => <a href={link.href} target={link.newWindow ? '_blank' : undefined} rel={link.newWindow ? 'noopener noreferrer' : undefined}>{link.label}</a>)}
       </nav>
     </div>
   </footer>
```

### `components/WarmStreamPagination.astro`

**状态：未修改，与原版文件逐字节一致。**

### `components/WarmToc.astro`

**状态：未修改，与原版文件逐字节一致。**

### `components/instantclick.ts`

**状态：未修改，与原版文件逐字节一致。**

### `components/viewimage.ts`

**状态：未修改，与原版文件逐字节一致。**

### `components/warm.ts`

**状态：已修改；以下为完整 unified diff。**

```diff
--- 原版/components/warm.ts
+++ 自定义/components/warm.ts
@@ -4,7 +4,7 @@
 import { formatDate, generateSlug } from '@/lib/content';
 import { escapeHtml } from '@/lib/escape';
 
-export const WARM_THEME_ID = 'typecho-theme-warm';
+export const WARM_THEME_ID = 'typecho-theme-warm-cy';
 
 export type WarmSection = 'home' | 'articles' | 'notes' | 'about' | 'none';
 export type WarmContinuousLoadMode = 'manual' | 'auto-2' | 'infinite';
@@ -12,9 +12,8 @@
 export type WarmCommentInitialLoadMode = 'manual' | 'auto-first' | 'auto-2' | 'infinite';
 
 export interface WarmSettings {
-  githubUrl: string;
-  socialUrl: string;
-  email: string;
+  pinnedIds: number[];
+  footerLinks: Array<{ text: string; url: string; newWindow: boolean }>;
   continuousLoadMode: WarmContinuousLoadMode;
   commentComponentLoadMode: WarmCommentComponentLoadMode;
   commentInitialLoadMode: WarmCommentInitialLoadMode;
@@ -34,16 +33,38 @@
       ? 'dwell'
       : settings.commentComponentLoadMode;
   const imageOptimizeParams = normalizeOptimizeParams(settings.imageOptimizeParams);
+  const pinnedIds = parsePinnedIds(settings.pinnedIds);
+  const footerLinks = Array.from({ length: 10 }, (_, index) => {
+    const suffix = String(index + 1).padStart(2, '0');
+    const text = typeof settings[`linktxt${suffix}`] === 'string' ? String(settings[`linktxt${suffix}`]).trim() : '';
+    const url = safeExternalUrl(settings[`links${suffix}`]);
+    const newWindowValue = settings[`linkblank${suffix}`];
+    return { text, url, newWindow: newWindowValue === true || newWindowValue === '1' || newWindowValue === 1 };
+  }).filter(link => link.text && link.url);
   return {
-    githubUrl: safeExternalUrl(settings.githubUrl),
-    socialUrl: safeExternalUrl(settings.socialUrl),
-    email: safeEmail(settings.email),
+    pinnedIds,
+    footerLinks,
     continuousLoadMode: normalizeContinuousLoadMode(settings.continuousLoadMode),
     commentComponentLoadMode: normalizeCommentComponentLoadMode(componentLoadMode),
     commentInitialLoadMode: normalizeCommentInitialLoadMode(settings.commentInitialLoadMode),
     imageOptimizeParams,
     thumbOptimizeParams: normalizeOptimizeParams(settings.thumbOptimizeParams) || imageOptimizeParams,
   };
+}
+
+export function parsePinnedIds(value: unknown): number[] {
+  if (typeof value !== 'string' && typeof value !== 'number') return [];
+  const parts = String(value).split(/[，,\s]+/);
+  const result: number[] = [];
+  const seen = new Set<number>();
+  for (const part of parts) {
+    if (!/^\d+$/.test(part.trim())) continue;
+    const cid = Number(part.trim());
+    if (!Number.isSafeInteger(cid) || cid <= 0 || seen.has(cid)) continue;
+    seen.add(cid);
+    result.push(cid);
+  }
+  return result;
 }
 
 function readSavedWarmSettings(options: ThemeBaseProps['options']): Record<string, unknown> | null {
@@ -76,8 +97,24 @@
 
 export function safeExternalUrl(value: unknown): string {
   if (typeof value !== 'string' || !value.trim()) return '';
+  const input = value.trim();
+
+  // Email links must keep the mailto: scheme. Treating `mailto:...` as a
+  // hostname and prepending https:// would incorrectly send users to a website.
+  if (/^mailto:/i.test(input)) {
+    const address = input.slice(input.indexOf(':') + 1).trim();
+    if (!address || /[\s<>]/.test(address) || !address.includes('@')) return '';
+    try {
+      const url = new URL(`mailto:${address}`);
+      return url.protocol === 'mailto:' && url.pathname.includes('@') ? url.toString() : '';
+    } catch {
+      return '';
+    }
+  }
+
   try {
-    const url = new URL(value.trim());
+    const normalized = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`;
+    const url = new URL(normalized);
     return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
   } catch {
     return '';
```

### `docs/UPGRADE-NOTES.md`

**状态：新增文件**

```text
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
```

### `package.json`

**状态：已修改；以下为完整 unified diff。**

```diff
--- 原版/package.json
+++ 自定义/package.json
@@ -1,9 +1,9 @@
 {
-  "name": "typecho-theme-warm",
+  "name": "typecho-theme-warm-cy",
   "version": "1.0.0",
-  "description": "A warm, humanistic single-column theme for Typecho-Workers with Notes support.",
+  "description": "Independent custom fork of Typecho Warm theme",
   "author": "Tokinx",
-  "homepage": "https://github.com/Tokinx/typecho-workers/tree/master/src/themes/typecho-theme-warm",
+  "homepage": "",
   "license": "MIT",
   "keywords": [
     "typecho",
```

### `style.css`

**状态：已修改；以下为完整 unified diff。**

```diff
--- 原版/style.css
+++ 自定义/style.css
@@ -291,6 +291,26 @@
   line-height: 1.6;
 }
 
+.warm-pinned-badge {
+  display: inline-flex;
+  align-items: center;
+  gap: 3px;
+  margin-left: 2px;
+  padding: 2px 6px;
+  border: 1px solid var(--warm-accent, #e66b5b);
+  border-radius: 999px;
+  color: var(--warm-accent, #e66b5b);
+  font-size: 0.75rem;
+  line-height: 1.3;
+  white-space: nowrap;
+}
+.warm-pinned-badge svg {
+  width: 12px;
+  height: 12px;
+  flex: 0 0 12px;
+}
+
+
 .warm-theme .warm-category,
 .warm-theme .warm-private,
 .warm-theme .warm-note-label {
```

### `theme.json`

**状态：已修改；以下为完整 unified diff。**

```diff
--- 原版/theme.json
+++ 自定义/theme.json
@@ -1,41 +1,207 @@
 {
-  "id": "typecho-theme-warm",
-  "name": "Typecho Warm",
-  "description": "静谧温润的单栏写作主题，支持文章与笔记混合时间线。",
+  "id": "typecho-theme-warm-cy",
+  "name": "Typecho Warm CY",
+  "description": "基于 Typecho Warm 的独立自定义主题。",
   "author": "Tokinx",
   "version": "1.0.0",
   "stylesheet": "style.css",
-  "homepage": "https://github.com/Tokinx/typecho-workers/tree/master/src/themes/typecho-theme-warm",
+  "homepage": "",
   "license": "MIT",
   "commentsMode": "api",
   "publicHtml": true,
-  "tags": ["warm", "minimal", "notes", "single-column"],
+  "tags": [
+    "warm",
+    "minimal",
+    "notes",
+    "single-column"
+  ],
   "config": {
-    "githubUrl": {
-      "type": "text",
-      "label": "GitHub 地址",
+    "pinnedIds": {
+      "type": "text",
+      "label": "首页置顶文章 ID",
+      "description": "只控制首页置顶。填写文章 ID，多个 ID 用英文逗号分隔；其他页面不受影响。",
       "default": ""
     },
-    "socialUrl": {
-      "type": "text",
-      "label": "社交主页地址",
+    "linktxt01": {
+      "type": "text",
+      "label": "页脚链接 1：显示文字",
+      "default": "",
+      "description": "留空则不显示这组链接。"
+    },
+    "links01": {
+      "type": "text",
+      "label": "页脚链接 1：链接地址",
+      "default": "",
+      "description": "支持 https://、http://、mailto:；普通域名可直接填写。"
+    },
+    "linkblank01": {
+      "type": "checkbox",
+      "label": "页脚链接 1：在新窗口打开",
+      "default": false
+    },
+    "linktxt02": {
+      "type": "text",
+      "label": "页脚链接 2：显示文字",
+      "default": "",
+      "description": "留空则不显示这组链接。"
+    },
+    "links02": {
+      "type": "text",
+      "label": "页脚链接 2：链接地址",
+      "default": "",
+      "description": "支持 https://、http://、mailto:；普通域名可直接填写。"
+    },
+    "linkblank02": {
+      "type": "checkbox",
+      "label": "页脚链接 2：在新窗口打开",
+      "default": false
+    },
+    "linktxt03": {
+      "type": "text",
+      "label": "页脚链接 3：显示文字",
+      "default": "",
+      "description": "留空则不显示这组链接。"
+    },
+    "links03": {
+      "type": "text",
+      "label": "页脚链接 3：链接地址",
+      "default": "",
+      "description": "支持 https://、http://、mailto:；普通域名可直接填写。"
+    },
+    "linkblank03": {
+      "type": "checkbox",
+      "label": "页脚链接 3：在新窗口打开",
+      "default": false
+    },
+    "linktxt04": {
+      "type": "text",
+      "label": "页脚链接 4：显示文字",
+      "default": "",
+      "description": "留空则不显示这组链接。"
+    },
+    "links04": {
+      "type": "text",
+      "label": "页脚链接 4：链接地址",
+      "default": "",
+      "description": "支持 https://、http://、mailto:；普通域名可直接填写。"
+    },
+    "linkblank04": {
+      "type": "checkbox",
+      "label": "页脚链接 4：在新窗口打开",
+      "default": false
+    },
+    "linktxt05": {
+      "type": "text",
+      "label": "页脚链接 5：显示文字",
+      "default": "",
+      "description": "留空则不显示这组链接。"
+    },
+    "links05": {
+      "type": "text",
+      "label": "页脚链接 5：链接地址",
+      "default": "",
+      "description": "支持 https://、http://、mailto:；普通域名可直接填写。"
+    },
+    "linkblank05": {
+      "type": "checkbox",
+      "label": "页脚链接 5：在新窗口打开",
+      "default": false
+    },
+    "linktxt06": {
+      "type": "text",
+      "label": "页脚链接 6：显示文字",
+      "default": "",
+      "description": "留空则不显示这组链接。"
+    },
+    "links06": {
+      "type": "text",
+      "label": "页脚链接 6：链接地址",
+      "default": "",
+      "description": "支持 https://、http://、mailto:；普通域名可直接填写。"
+    },
+    "linkblank06": {
+      "type": "checkbox",
+      "label": "页脚链接 6：在新窗口打开",
+      "default": false
+    },
+    "linktxt07": {
+      "type": "text",
+      "label": "页脚链接 7：显示文字",
+      "default": "",
+      "description": "留空则不显示这组链接。"
+    },
+    "links07": {
+      "type": "text",
+      "label": "页脚链接 7：链接地址",
+      "default": "",
+      "description": "支持 https://、http://、mailto:；普通域名可直接填写。"
+    },
+    "linkblank07": {
+      "type": "checkbox",
+      "label": "页脚链接 7：在新窗口打开",
+      "default": false
+    },
+    "linktxt08": {
+      "type": "text",
+      "label": "页脚链接 8：显示文字",
+      "default": "",
+      "description": "留空则不显示这组链接。"
+    },
+    "links08": {
+      "type": "text",
+      "label": "页脚链接 8：链接地址",
+      "default": "",
+      "description": "支持 https://、http://、mailto:；普通域名可直接填写。"
+    },
+    "linkblank08": {
+      "type": "checkbox",
+      "label": "页脚链接 8：在新窗口打开",
+      "default": false
+    },
+    "linktxt09": {
+      "type": "text",
+      "label": "页脚链接 9：显示文字",
+      "default": "",
+      "description": "留空则不显示这组链接。"
+    },
+    "links09": {
+      "type": "text",
+      "label": "页脚链接 9：链接地址",
+      "default": "",
+      "description": "支持 https://、http://、mailto:；普通域名可直接填写。"
+    },
+    "linkblank09": {
+      "type": "checkbox",
+      "label": "页脚链接 9：在新窗口打开",
+      "default": false
+    },
+    "linktxt10": {
+      "type": "text",
+      "label": "页脚链接 10：显示文字",
+      "default": "",
+      "description": "留空则不显示这组链接。"
+    },
+    "links10": {
+      "type": "text",
+      "label": "页脚链接 10：链接地址",
+      "default": "",
+      "description": "支持 https://、http://、mailto:；普通域名可直接填写。"
+    },
+    "linkblank10": {
+      "type": "checkbox",
+      "label": "页脚链接 10：在新窗口打开",
+      "default": false
+    },
+    "imageOptimizeParams": {
+      "type": "text",
+      "label": "图片优化参数",
+      "description": "图片优化参数，例如：?quality=80。留空表示不追加参数。",
       "default": ""
     },
-    "email": {
-      "type": "text",
-      "label": "联系邮箱",
-      "default": ""
-    },
-    "imageOptimizeParams": {
-      "type": "text",
-      "label": "图片优化参数",
-      "description": "适用于站内所有图片，示例：?quality=80",
-      "default": ""
-    },
     "thumbOptimizeParams": {
       "type": "text",
       "label": "缩略图优化参数",
-      "description": "适用于主题所有缩略图位置，示例：?quality=80&width=500",
+      "description": "缩略图优化参数，例如：?quality=80&width=500。留空表示不追加参数。",
       "default": ""
     },
     "continuousLoadMode": {
```

## 4. 重点功能与文件对应

| 功能 | 对应文件 | 同步时重点检查 |
|---|---|---|
| 首页置顶文章排序、避免重复、置顶徽标展示 | `components/Index.astro`、`style.css` | 原版更新首页查询、文章卡片结构时，重新核对置顶查询和列表排序；保留 `.warm-pinned-badge` 样式及模板调用。
| 自定义页脚链接输出与 RSS 顺序 | `components/WarmShell.astro` | 对照上游页脚 HTML 结构；自定义链接应保留在 RSS 之前，外链保留安全属性。
| 置顶 ID 与页脚链接配置解析 | `components/warm.ts` | 检查主题设置读取、字段名、URL 校验和默认值是否仍与模板一致。
| 主题标识与后台设置项 | `theme.json` | 上游新增设置时需合并，不要覆盖自定义主题 ID 和新增配置字段。
| 独立主题包元信息 | `package.json` | 同步上游依赖/脚本时保留需要的自定义包名与项目元信息。
| 升级提示 | `docs/UPGRADE-NOTES.md` | 自定义新增文档；按项目实际部署流程维护。

## 5. 页脚 CSS 核验

当前 `style.css` 相对原版的文本差异只涉及首页置顶徽标 `.warm-pinned-badge` 规则；原版页脚规则未被修改。原版页脚布局包括 `.warm-footer__meta`、`.warm-footer__copyright` 与 `.warm-footer__meta nav`，在自定义文件中保持原样，因此不会强制页脚链接右对齐或强制单行。

## 6. 上游升级时的逐文件同步流程

1. 备份当前自定义主题和线上可用版本。
2. 下载/切换到新版上游仓库，先比较新版 `src/themes/typecho-theme-warm/` 与本档案记录的原版基线。
3. 先同步没有差异的文件；对有差异的文件逐个查看新版上游改动，不要直接用自定义旧文件覆盖新版。
4. 优先人工合并 `components/Index.astro`、`components/WarmShell.astro`、`components/warm.ts`、`theme.json`、`package.json`。
5. `style.css` 通常只需保留上游新样式并确认 `.warm-pinned-badge` 仍存在；页脚 CSS 应继续以新版原版的对应规则为准。
6. 对照 `theme.json` 与 `warm.ts` 检查设置字段一一对应，再检查模板中读取字段的名称。
7. 本地构建并验证首页置顶、文章详情、分类/归档页、页脚链接、RSS 链接和移动端页脚换行。
8. 生成新主题 ZIP 前检查压缩包顶层只有 `typecho-theme-warm-cy/`，不要把整个仓库打进去。

## 7. 验证范围与限制

- 已按当前目录进行文件清单与逐文件内容比较，并重新打包主题目录。
- 本档案不声称已完成 Cloudflare Workers 线上部署或线上浏览器测试。
- 如当前目录并非准备发布的最终源码，请先确认源码版本，再据此重新生成档案。
