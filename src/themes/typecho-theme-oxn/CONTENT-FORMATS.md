# OXN / Typecho-Workers 内容输入与格式支持说明

本文依据支线 1 当前源码整理，覆盖文章、独立页面、评论、HTML 安全过滤、OXN 主题扩展、自定义字段和友情链接模板。它描述的是项目实际处理规则，不等于浏览器支持的所有 HTML 都会被本站保留。

## 1. 内容处理流程

正文大致经过三层：

1. 后台编辑器预览：使用 HyperDown 生成预览，允许 HTML 输入，并使用 DOMPurify 清理预览结果。
2. 服务端渲染：文章和独立页面正文由 marked 解析 Markdown，再由 sanitize-html 按白名单清理；插件还可通过内容过滤钩子参与处理。
3. OXN 主题显示：在服务端渲染结果上进行图片优化、文章目录、提示框图标、友情链接区块等主题处理。

因此，编辑器预览能显示，不代表最终页面一定原样保留。判断支持情况应以服务端最终输出为准。

## 2. Markdown 正文

文章和普通独立页面使用统一 Markdown 渲染流程。解析器为 marked，按默认 GitHub Flavored Markdown（GFM）行为解析。

### 2.1 行内格式

| 用途 | 输入示例 |
|---|---|
| 粗体 | **粗体**（输入：双星号包围文字） |
| 斜体 | *斜体*（输入：单星号包围文字） |
| 删除线 | ~~删除线~~ |
| 行内代码 | 使用单个反引号包围代码 |
| 链接 | [链接文字](https://example.com) |
| 图片 | ![图片说明](https://example.com/image.png) |
| 引用式链接 | [链接][ref]，并在文末定义 [ref]: https://example.com |
| 自动链接 | 直接输入完整 URL，按 GFM 规则识别 |

### 2.2 块级格式

- 标题：一级至六级标题，使用 1 至 6 个 #。
- 段落：段落之间空一行。
- 无序列表：使用 -、* 或 + 开头。
- 有序列表：使用数字加点号开头。
- 引用：使用 > 开头。
- 分隔线：使用 ---、*** 或 ___。
- 代码块：使用三个反引号包围代码，可在开头标注语言。
- 表格：支持 GFM 管道表格。
- 任务列表：支持 - [ ] 未完成、- [x] 已完成。
- 支持 GFM 自动链接、常见行内强调和删除线语法。

代码块示例：

~~~js
const message = 'Hello';
console.log(message);
~~~

表格示例：

~~~markdown
| 名称 | 说明 |
| --- | --- |
| Markdown | 文本标记 |
| HTML | 结构标记 |
~~~

任务列表示例：

~~~markdown
- [ ] 待处理
- [x] 已完成
~~~

### 2.3 GitHub 风格提示框（项目扩展）

正文支持 GitHub 风格提示框：

~~~markdown
> [!NOTE]
> 普通说明。

> [!TIP]
> 技巧或建议。

> [!IMPORTANT]
> 重要信息。

> [!WARNING]
> 警告信息。

> [!CAUTION]
> 需要谨慎处理的内容。
~~~

提示框转换器识别引用块首行的 [!标签]。NOTE、TIP、IMPORTANT、WARNING、CAUTION 是主题识别的常见类型；主题会为这些类型补充对应 Octicon 图标。其他自定义标签也会生成通用提示框标题，但不保证有专属颜色或图标。

普通引用（例如 > 这只是引用）不会转换成提示框。评论开启 Markdown 时也支持提示框语法。

### 2.4 Typecho 正文标记

- <!--markdown-->：位于正文开头时作为 Markdown 标记前缀处理，渲染时移除，不显示在页面。
- <!--more-->：摘要/阅读全文分界标记。列表摘要只显示标记之前的内容；详情页完整正文渲染时移除标记本身。

more 标记不是普通的可见 HTML 内容。摘要渲染会先解析完整 Markdown，再按标记切分，所以标记前使用、标记后定义的引用式链接仍可正确解析。

## 3. HTML 正文与安全过滤

文章和独立页面允许直接输入 HTML，但服务端会执行白名单清理。允许某个标签，不代表该标签的任意属性、URL、脚本都允许。

### 3.1 正文额外允许的 HTML 标签

除 sanitize-html 默认标签外，项目额外允许：

- 标题与文本：h1、h2、h3、h4、h5、h6、small、u、mark、abbr、sub、sup、time。
- 图片与媒体：img、picture、video、audio、source。
- 代码与表格：pre、code、table、thead、tbody、tfoot、tr、th、td。
- 语义布局：div、span、section、article、main、header、footer、nav、aside、figure、figcaption。
- 详情与定义列表：details、summary、dl、dt、dd。
- 表单控件：form、fieldset、legend、input、select、option、textarea、output、progress、meter、button、label。
- SVG：svg、g、path、circle、rect、line、polyline、polygon、ellipse、text、tspan、defs、use、symbol、mask、clipPath、filter、linearGradient、radialGradient、stop、style、image、title、desc、marker、pattern、feGaussianBlur、feOffset、feComponentTransfer、feFuncA、feMerge、feMergeNode。

另外还包含 sanitize-html 默认允许的基础标签。标签不在最终允许集合中时，会被移除或按清理规则处理。

### 3.2 常见允许属性

- 全局属性：class、id、title、style、role、aria-*、data-*。
- 链接 a：href、title、target、rel、download。
- 图片 img：src、alt、title、width、height、loading。
- code、pre：class。
- video：src、controls、width、height、poster。
- audio：src、controls。
- source：src、srcset、sizes、type、media。
- iframe：src、width、height、frameborder、allowfullscreen、allow、sandbox、loading、referrerpolicy。
- SVG：保留源码明确列出的绘图、尺寸、填充、描边、渐变、变换和滤镜属性。

未列出的属性不会因为浏览器支持就自动放行。onclick、onload 等事件处理属性不属于正文允许属性。

### 3.3 内联 style

正文允许 style 属性，但 CSS 值受安全规则检查。当前白名单覆盖常用的：

- 颜色与背景：color、fill、stroke、透明度、background、background-color、background-image。
- 字体与文字：font-size、font-family、font-weight、font-style、line-height、text-align、text-decoration、text-shadow。
- 布局：display、position、top、right、bottom、left、z-index、flex、flex-direction、flex-wrap、justify-content、align-items、gap、grid-template-columns、grid-template-rows。
- 尺寸与盒模型：width、height、max-width、max-height、min-width、min-height、margin、padding、border、border-radius、box-shadow。
- 其他：overflow、cursor、object-fit、vertical-align、white-space。

危险 CSS 值会被拒绝，包括脚本执行、危险 URL、@import、expression()、behavior、-moz-binding 等风险写法。SVG 的绘图属性也有单独规则。

### 3.4 iframe 外部嵌入限制

正文 iframe 仅允许以下主机：

- www.youtube.com
- www.bilibili.com
- player.bilibili.com
- player.vimeo.com

其他域名 iframe 的 src 不会保留。javascript: 等危险协议也会被过滤。第三方网站提供了 iframe 代码，不代表本站一定允许嵌入。

### 3.5 图片尺寸与优化

图片地址中的 width、height 参数在符合规则时会转换为图片元素属性，单项尺寸上限为 16384。OXN 主题还会按图片优化设置处理站内图片 URL。

### 3.6 HTML 示例

加粗与颜色：

~~~html
<strong>加粗文字</strong>
<span style="color:#e74c3c;">红色文字</span>
~~~

自定义提示块：

~~~html
<div style="padding:12px 16px;border:1px solid #ddd;border-radius:8px;">
  这里是自定义内容。
</div>
~~~

图片：

~~~html
<img src="https://example.com/image.png" alt="图片说明" width="640">
~~~

不应依赖以下能力：script 执行、onclick 等事件属性、不受信任域名 iframe、javascript: 等危险协议。不要把脚本代码当作可执行内容输入。

## 4. 评论内容的输入规则

评论使用独立于文章正文的清理策略：

- 评论 Markdown 关闭时：按纯文本和自动分段方式处理，默认不允许 HTML 标签。
- 评论 Markdown 开启时：支持 Markdown，并允许较精简的评论 HTML 标签集合。
- 评论 Markdown 模式支持图片、代码块、链接及提示框所需的基础标签，但不等同于正文完整 HTML 白名单。
- 评论链接只保留 href、title、target、rel；图片只保留 src、alt、title；代码标签保留 class。
- 管理员可通过评论 HTML 标签白名单设置扩展允许的标签和属性；属性名仍经过安全属性检查。

评论中需要复杂排版时优先使用 Markdown。不要假设正文中可用的表单、SVG、iframe 等标签也能在评论中使用。

## 5. OXN 主题图标字串

OXN 提供统一图标输入解析器，供主题页脚链接、独立页面图标字段和导航标签等指定位置使用。

### 5.1 推荐语法

~~~text
{{octicon:home}}
{{octicon:mark-github}}
{{octicon:home|size=20}}
{{octicon:home|title=返回首页}}
{{octicon:home|size=20|title=返回首页}}
~~~

参数说明：

- size：整数像素尺寸，范围 1–256；不合法时忽略，使用调用位置默认尺寸。
- title：图标辅助说明文字，会作为 SVG 的可访问名称/标题。
- 参数用英文竖线 | 分隔。

### 5.2 兼容语法

~~~text
{{icons:mark-github}}
{{icons:home|size=20}}
mark-github
home
~~~

- {{icons:name}} 是旧语法，继续兼容。
- 直接输入图标名称也兼容，但仅在调用位置按“图标输入”解析时才会被当作图标。
- 名称可附带 -16 或 -24 尺寸变体，例如 home-16、mark-github-24。这两种是图标库变体，不是普通 size 参数。
- 无效名称在图标专用字段中通常不输出图标；普通文本模式下会退回显示原文字。

### 5.3 图标库

图标来自 GitHub Primer Octicons，并额外提供 OXN 自定义图标别名：

- cf
- cloudflare
- bilibili

完整上游图标名称以项目依赖的 Octicons 版本为准。不存在的图标名称不会自动生成图标。

### 5.4 图标与普通 HTML 混用

图标后可以继续写文字：

~~~text
{{octicon:mark-github|size=18}} GitHub
~~~

图标解析器允许输入中包含原生 HTML/SVG；但图标字段解析器与正文 Markdown 的 HTML 白名单是不同处理路径。不要把图标字段可接受原生 SVG 等同于所有正文位置都不经清理。

## 6. OXN 主题自定义设置中的 HTML 与字串

### 6.1 页脚链接

OXN 主题设置提供多组页脚链接，每组包含显示文字、链接地址和是否新窗口打开等设置。显示文字支持图标语法，例如：

~~~text
{{octicon:mark-github|size=16}} GitHub
~~~

也兼容 {{icons:github}}。链接地址需为安全 URL；空地址或没有有效文字/图标的项目不会输出。

### 6.2 自定义导航名称

OXN 可自定义“首页”“文章”“笔记”的导航显示名称。输入为空时使用主题默认名称。自定义名称支持图标字串格式，解析规则与页脚文字一致。

### 6.3 页脚自定义 HTML

主题设置中的页脚自定义 HTML 是独立 HTML 输入区域，不是 Markdown 正文。它支持 HTML、内联样式及内嵌 style。主题会把其中 CSS 选择器限制在页脚自定义内容容器内，避免普通选择器意外影响整个网站。

这是主题管理员配置入口，不应与访客评论或普通正文的 HTML 安全边界混为一谈。不要粘贴来源不明的脚本。

### 6.4 文章声明 HTML

文章声明区域使用 HTML 模板，并支持以下占位符：

| 占位符 | 替换内容 |
|---|---|
| {site.name} | 站点名称 |
| {site.url} | 站点地址 |
| {site.description} | 站点描述 |
| {post.title} | 当前文章标题 |
| {post.url} | 当前文章链接 |

示例：

~~~html
<div class="article-declaration">
  本文由 <a href="{site.url}">{site.name}</a> 发布。
  <a href="{post.url}">查看《{post.title}》</a>
</div>
~~~

占位符替换时会对对应文本进行 HTML 转义，避免标题或站点资料中的特殊字符破坏 HTML 属性或结构。

## 7. Typecho 原生自定义字段

自定义字段没有预先固定的字段清单。后台编辑文章或独立页面时，可以自行添加字段名称、字段类型和值。

### 7.1 字段类型

| 类型值 | 后台显示 | 数据库存储 | 说明 |
|---|---|---|---|
| str | 字符 | str_value | 字符串、文本、URL、JSON 文本等 |
| int | 整数 | int_value | 整数 |
| float | 小数 | float_value | 浮点数 |

字段保存在 typecho_fields 表中，按 cid + name 唯一。同一篇内容的字段名不能重复，不同内容可以使用相同字段名。

### 7.2 字段名规则

字段名必须以英文字母或下划线开头，后续只能使用英文字母、数字和下划线。验证规则：

~~~regex
^[_a-zA-Z][_a-zA-Z0-9]*$
~~~

### 7.3 示例

字段名 subtitle，类型 str，值为副标题文字。

字段名 price，类型 float，值为 19.9。

字段名 rank，类型 int，值为 3。

### 7.4 字段值与前台显示

- str 字段可保存普通文字、URL、Markdown 源文本或 JSON 文本。
- int、float 会按数值类型解析，不适合保存任意长文本。
- 保存为字符串，不代表系统会自动把它渲染成 HTML、Markdown 或主题组件。
- 某个字段是否有前台效果，取决于主题或插件是否明确读取该字段并实现对应渲染逻辑。

**重要：** OXN 当前友情链接模板从页面正文中的 FRIENDLINKS 标记区块读取数据。仅仅创建一个名为 links 的自定义字段，不会自动把字段内容转换成友情链接卡片。字段存储能力与主题模板读取能力是两回事。

## 8. OXN 友情链接模板输入格式

OXN 主题提供独立页面模板“友情链接”。在独立页面编辑界面选择该模板，然后在正文中放入成对标记：

~~~text
[[FRIENDLINKS:START]]

示例网站
https://example.com
一个示例网站

[[FRIENDLINKS:END]]
~~~

标记区块中的数据会转换成友情链接卡片；标记区块以外的正文仍按普通正文显示。该解析仅由友情链接页面模板执行，普通独立页面不会自动处理这些标记。

### 8.1 多行格式（推荐）

每个友情链接占用一个段落，段落内按行填写：

1. 第一行：网站名称。
2. 第二行：网站 URL。
3. 第三行及以后：网站描述，多行描述会合并为一段。

~~~text
[[FRIENDLINKS:START]]

示例网站
https://example.com
一个用于演示的示例网站。

另一个网站
https://another.example
第二个网站的说明文字。

[[FRIENDLINKS:END]]
~~~

### 8.2 单行混合格式

也支持在同一段落中把名称、URL、描述写在一行：

~~~text
[[FRIENDLINKS:START]]

示例网站 https://example.com 一个用于演示的示例网站。

另一个网站 https://another.example 第二个网站的说明。

[[FRIENDLINKS:END]]
~~~

解析器会从该行识别第一个 HTTP/HTTPS URL：URL 前面作为名称，URL 后面作为描述。URL 末尾的常见标点会被剥离。

### 8.3 混合使用

同一个标记区块内可以混合多行格式和单行格式。每个有效段落单独生成一个友链卡片。

### 8.4 URL 与无效数据处理

- 只接受可被 URL 解析的 http: 或 https: 地址。
- 网站名称不能为空。
- URL 缺失、格式无效或协议不是 HTTP/HTTPS，该条目会被跳过。
- 描述可以留空。
- 无效条目不会阻止其他有效条目显示。

### 8.5 标记区块注意事项

- 开始标记为 [[FRIENDLINKS:START]]，结束标记为 [[FRIENDLINKS:END]]。
- 标记需要成对出现；未闭合或嵌套标记不会被当作有效区块删除解析，避免误删后续正文。
- 标记区块以外的正文会保留并正常显示。
- 区块内的友链数据不会作为普通正文展示，而是转换为友情链接卡片。
- 页面可以包含多个有效的成对区块，各区块中的有效段落都会参与展示。

### 8.6 与 Wing / WordPress links 字段的区别

当前 OXN 友情链接模板以正文标记区块为数据来源。它不会自动读取或转换 Wing / WordPress 的 links JSON 自定义字段。如果导入内容只有 links JSON 字段而正文没有上述标记区块，当前模板不会自动生成友链卡片。

## 9. 输入位置速查

| 输入位置 | 主要格式 | 是否自动渲染 |
|---|---|---|
| 文章正文 | Markdown + 白名单 HTML | 是 |
| 普通独立页面正文 | Markdown + 白名单 HTML | 是 |
| 评论 | 纯文本或 Markdown；HTML 受评论白名单限制 | 是 |
| Typecho 自定义字段 | 字符串、整数、小数 | 否，需主题或插件读取 |
| OXN 图标输入位置 | {{octicon:...}}、兼容 {{icons:...}}、图标名称 | 是，仅限指定主题输入位置 |
| OXN 页脚自定义 HTML | HTML + 容器作用域 CSS | 是 |
| OXN 文章声明 | HTML + 指定占位符 | 是 |
| OXN 友情链接模板 | 正文标记区块 + 每条友链段落 | 是，仅限友情链接页面模板 |

## 10. 使用建议

1. 普通文章排版优先使用 Markdown；需要特殊布局时再使用白名单内的 HTML。
2. 不要在正文、评论或自定义字段中依赖 JavaScript 执行。
3. iframe 只使用当前允许的媒体主机。
4. 需要常用图标时优先使用 OXN 图标字串，避免复制来源不明的 SVG。
5. JSON 放进 str 自定义字段后只是文本；除非主题或插件专门解析，否则不会自动生成界面。
6. 友情链接建议使用多行格式，名称、URL、描述更容易检查；每条友链单独成段。
7. 保存后以文章/页面前台最终输出为准，不要只依据编辑器即时预览判断。

## 11. 对应源码

- src/lib/markdown.ts：Markdown 渲染、正文 HTML 白名单、评论 HTML 白名单、Typecho 标记及评论格式处理。
- src/lib/markdown-alerts.ts：GitHub 风格提示框转换。
- tests/unit/markdown.test.ts：Markdown、提示框、评论、iframe 清理等行为测试。
- src/pages/api/admin/content.ts：自定义字段名称/类型验证及保存。
- src/db/schema.ts：typecho_fields 表结构。
- src/themes/typecho-theme-oxn/components/octicons.ts：OXN 图标字串解析与 SVG 输出。
- src/themes/typecho-theme-oxn/components/warm.ts：主题设置、页脚链接与导航文字读取。
- src/themes/typecho-theme-oxn/components/FriendLinks.astro：友情链接标记区块解析和卡片渲染。
- src/themes/typecho-theme-oxn/components/Page.astro、Post.astro：独立页面和文章的主题显示处理。
- src/themes/typecho-theme-oxn/theme.json：OXN 主题设置项及页面模板注册。
