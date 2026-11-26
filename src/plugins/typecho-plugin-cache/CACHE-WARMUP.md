# 内容变更时的页面缓存预热说明

本文根据支线 `1` 当前源码整理，说明发布、编辑文章或独立页面时，哪些 URL 会被主动预热，以及隐藏内容是否会产生 KV 页面缓存写入。

## 结论

**隐藏文章和隐藏独立页面都会进入当前的主动预热流程。**

原因不是预热器遍历了所有内容，而是内容可见性判断将 `status: 'hidden'` 与 `status: 'publish'` 都视为已发布内容：

- `src/lib/content-visibility.ts`：`canViewContent()` 中 `isPublished` 判断包含 `publish` 和 `hidden`。
- `src/pages/api/admin/content.ts`：保存内容后通过 `canViewContent(content, {})` 得到 `isPublic`，并据此决定是否执行预热。
- `type` 为文章还是独立页面，不会改变上述 `hidden` 状态判断。

因此，隐藏文章和隐藏独立页面在保存后，都可能把自己的永久链接加入预热列表。

## 实际预热哪些页面

预热 URL 由 `src/lib/cache.ts` 的 `buildContentWarmupUrls()` 生成。当前列表由以下部分组成，并通过 `Set` 去重：

1. 首页：`/`
2. 主 Feed：`/feed`
3. 本次变更内容的永久链接（调用方提供时）
4. 本次内容关联的分类归档 URL（调用方提供时）
5. 本次内容关联的标签归档 URL（调用方提供时）

**不会因为网站有 100 篇或 1000 篇文章，就在每次发布时遍历并预热全部文章详情页。** 当前代码只把本次变更内容的 permalink 和上述首页、Feed、关联归档 URL 放入列表；其他文章和独立页面不会仅因这次发布而逐篇预热。

## 不同内容状态的行为

| 内容状态 | `canViewContent(content, {})` | 当前保存流程是否进入预热分支 |
| --- | --- | --- |
| 普通公开文章 | true | 是 |
| 隐藏文章 | true | 是 |
| 普通公开独立页面 | true | 是 |
| 隐藏独立页面 | true | 是 |
| 草稿（包括草稿类型） | false | 新建草稿不会 |
| 私密内容 | false | 新建私密内容不会 |
| 尚未到发布时间的内容 | false | 新建未来内容不会 |

说明：编辑或删除**此前已经公开**的内容时，调用方还会传入 `wasPublic`。因此，即使本次操作将内容改为非公开，失效/预热分支也可能因 `wasPublic` 而进入；这与新建一篇草稿或私密内容的情况不同。实际响应是否可缓存仍由页面缓存策略决定。

## 预热请求是否一定产生 KV 写入

不是。预热 URL 数量不等于 KV Writes 数量。

`warmPublicCacheUrls()` 会对列表中的 URL 发起 GET 请求，并附带：

- `Cache-Control: no-cache`
- `X-Typecho-Cache-Warmup: 1`（由缓存模块定义的预热标记）

预热标记让页面缓存请求策略按读写模式处理。只有页面成功返回符合缓存条件的响应，并且 L2（Workers KV）TTL 大于 0、KV 绑定可用时，该页面才会产生对应的 L2 KV 页面缓存写入。

因此：

- 100 个预热 URL **不代表必然**有 100 次 KV.put。
- 如果 100 个 URL 都成功生成可缓存响应，并实际写入 L2，才会对应 100 次页面缓存 KV.put。
- L2 关闭、KV 未绑定、响应不可缓存或预热请求失败时，不会产生对应的 L2 页面缓存写入。
- 预热写入的是页面缓存内容；内容变更时推进 generation 的 KV 写入属于另一类操作，应分开统计。
- L1 Cache API 的写入和 L3 D1 的写入都不是 Workers KV Writes。

## 对 KV 用量的影响

当前主动预热范围是“首页 + Feed + 本次内容 permalink + 本次关联分类/标签归档”，不是全站文章/页面清单。

如果希望降低 KV 写入，应重点审视是否需要每次内容变更都预热隐藏内容的 permalink，以及是否需要预热相关归档 URL。可以调整主动预热的筛选范围，同时保留页面被真实访客访问时按正常缓存策略缓存的能力。**仅把内容从导航栏或列表中隐藏，并不会自动阻止它进入预热流程。**

## 对应源码位置

- `src/lib/content-visibility.ts`：`canViewContent()` 对公开、隐藏、草稿、私密和未来内容的判断。
- `src/pages/api/admin/content.ts`：`purgeContentAndRelatedCache()` 中的 `isPublic` / `wasPublic` 判断及预热调用；新建、更新内容时传入 `warmContentUrl: true`。
- `src/lib/cache.ts`：`buildContentWarmupUrls()` 生成 URL 列表；`warmPublicCacheUrls()` 发起预热请求。

本文只记录当前代码行为，不代表已经修改预热策略。
