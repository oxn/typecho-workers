# CoreDownload 下载增强

CoreDownload 是从 WordPress 原版插件移植到 Typecho Workers 的下载信息展示插件。用于在文章中添加网盘或其他下载地址，并在文章前台展示下载区域。

## 作者与原版信息

- **原插件作者：** Applek（果核剥壳）
- **原插件项目：** https://github.com/sbqtmd/core-download
- **原插件主页：** https://www.lovestu.com/coredownload.html
- **原插件使用文档：** https://www.yuque.com/applek/coredownload

本项目是面向 Typecho Workers 的移植版本，并非原作者发布的 WordPress 插件。移植版尽量沿用原版的数据字段、数据编码方式、前台结构、样式和交互；部分依赖 WordPress 环境的功能不适用于 Workers，因此没有照搬。

## 功能简介

- 在文章编辑页面配置下载信息，可添加多条下载地址。
- 支持选择网盘/下载来源类型，填写下载链接、提取码和资源描述。
- 可填写下载区域的说明内容。
- 支持全站总开关，以及单篇文章独立开关。
- 前台下载区域由浏览器端渲染。
- 提取码支持复制，并提供复制结果反馈。
- 支持设置主题颜色、边框弧度、投诉地址和版权声明。
- 前台样式适配网站暗黑模式。

## 使用说明

### 1. 启用插件

将插件部署到 Typecho Workers 项目后，进入 Typecho 后台的插件管理页面，找到 **CoreDownload 下载增强** 并启用。

### 2. 配置全局设置

启用后，进入后台的 **CoreDownload 设置** 页面：

1. 打开“总开关”。关闭总开关时，所有文章的下载区域都不会显示。
2. 按需设置主题颜色和边框弧度。
3. 如需显示投诉入口，可填写投诉地址。
4. 可修改下载区域底部显示的版权声明。
5. 点击“保存”使设置生效。

首次使用时请特别检查“总开关”，它默认关闭。

### 3. 在文章中添加下载信息

进入文章新增或编辑页面，在文章编辑区域下方找到 CoreDownload 下载编辑区：

1. 按需开启当前文章的下载功能。
2. 在说明内容编辑区填写下载说明、资源介绍等内容；可使用编辑区提供的基础格式工具。
3. 点击“添加下载地址”，新增一条下载记录。
4. 选择对应的网盘或下载来源类型。
5. 填写下载链接。
6. 如下载资源设有提取码，填写提取码；没有则留空。
7. 填写资源描述，方便读者识别该条下载内容。
8. 如有多个下载地址，可继续添加；不需要的条目可在编辑区内删除。
9. 正常保存或发布文章。

下载编辑区的位置保持在文章编辑区域下方；“添加下载地址”按钮也保留在原来的编辑区中。

### 4. 前台显示条件

一篇文章需要同时满足以下条件，前台才会显示下载区域：

- 插件已启用；
- 插件全局设置中的“总开关”已开启；
- 当前文章的下载开关已开启；
- 当前文章至少添加了一条下载地址；
- 如果文章设置了访问密码，访客需要先解锁文章。

如果前台没有显示下载区域，请按以上条件逐项检查。

## 数据兼容与移植说明

为兼容原版 WordPress CoreDownload 的文章数据，移植版沿用以下数据名称和编码格式：

- 文章字段：`core_download_meta_box`
- 全局设置：`core_download_set`
- 数据格式：Base64 编码的 JSON；说明内容字段内部仍保存 Base64 编码的 HTML。

从 WordPress 导入文章时，插件会兼容读取导入器保留的 `wordpress:core_download_meta_box` 字段。编辑并保存文章后，数据会写回 `core_download_meta_box`。

WordPress 的 `wp_options` 不会由当前 WXR 导入器自动迁移，因此原站全局设置不会随文章自动带入。迁移后需要在本插件的设置页面重新确认并保存全局设置；文章中的下载列表数据无需因此重新录入。

## 与原版的差异

- 本版本运行于 Typecho Workers，不依赖 WordPress 后台或 WordPress 数据库 API。
- 文章下载数据保存到 Typecho 的文章字段，全局设置保存到 Typecho 选项。
- 原版依赖 WordPress TinyMCE 的内容编辑器，在移植版中使用插件自己的富文本编辑区域承接相同的说明内容字段。
- 原版自动更新功能依赖 WordPress 插件更新接口及文件系统覆盖机制，不适用于 Workers，因此本版本不提供该自动更新功能。
- 原版源码未发现独立的下载口令验证逻辑，本版本也没有额外增加一套口令验证机制。

## 原版文件移植对应

| WordPress 原版文件 | Typecho Workers 移植位置/用途 |
| --- | --- |
| `core/Options.php` | `service.ts`：文章字段、Base64(JSON) 编码及全局设置 |
| `core/Plugin.php` | `index.ts` 及主题文章页面接入：文章显示入口与启用条件 |
| `template/components/download-warp.php` | `client.ts`：前台下载区域外层结构 |
| `template/components/download-url-item.php` | `client.ts`：下载地址卡片结构 |
| `static/css/front.css` | 前台下载区域样式 |
| `static/js/home.min.js` | 前台复制提取码交互 |
| `static/js/editor.min.js` | 后台下载列表编辑控件 |
| `static/img` 中的 SVG 图标 | 插件图标资源及图标模块 |

## 扩展维护说明：增加网盘图标与选项

本节说明后续维护者如何在源码中增加网盘类型、图标，以及新增插件全局设置项。当前版本的网盘类型列表和全局设置是写在代码中的，并不是后台可视化动态管理；增加项目需要同步修改对应位置。

### 一、增加一种网盘类型和图标

目前网盘类型由文章编辑器中的选项、前台名称映射和 SVG 图标映射共同决定。只增加图标文件而不补齐这些映射，后台可能无法选择，或前台只显示空白图标/空名称。

假设要新增一个网盘，内部标识使用 `example`，后台显示名称使用“示例网盘”：

1. **准备 SVG 图标。** 准备该网盘的 SVG 矢量图，建议沿用现有图标的画布比例和视觉尺寸。图标应是可信来源的静态 SVG；避免带脚本、外部资源引用或不必要的交互内容。
2. **登记前台图标。** 在 `src/plugins/typecho-plugin-core-download/icons-netdisk.ts` 的 `CORE_DOWNLOAD_NETDISK_ICONS` 对象中增加 `example` 键，值为 SVG 字符串。前台根据文章记录中的 `name` 值查找这里的图标。
3. **登记前台显示名称。** 在 `src/plugins/typecho-plugin-core-download/client.ts` 的 `NETWORK_NAMES` 对象中增加 `example: '示例网盘'`。否则前台卡片无法显示对应名称。
4. **登记后台下拉选项。** 在 `public/plugins/typecho-plugin-core-download/static/js/editor.min.js` 的网盘类型 `el-option` 列表中增加一项，显示标签为“示例网盘”，值为 `example`。该文件是编译后的压缩 bundle；如果项目后续补齐了对应源文件，应优先修改源文件并重新构建，不要只在压缩代码中盲目替换。
5. **检查前台图标。** 确认后台选择该类型并保存文章后，文章数据中的 `download_list[].name` 保存为 `example`；前台应能通过同一个键匹配名称和 SVG 图标。

示意代码（只展示需要增加的映射，不是完整 SVG）：

```ts
// icons-netdisk.ts
export const CORE_DOWNLOAD_NETDISK_ICONS = {
  // 保留现有图标……
  example: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">…</svg>',
};

// client.ts
const NETWORK_NAMES = {
  // 保留现有名称……
  example: '示例网盘',
};
```

注意：以上两个 TypeScript 对象中的键必须完全一致，并且必须与编辑器下拉选项的 `value` 完全一致。建议使用简短、稳定的小写英文标识；不要把中文显示名称直接当作数据标识。

当前内置网盘标识包括：`local`、`baidu`、`aliyun`、`123`、`quark`、`lanzou`、`ct`、`github`、`weiyun`、`tianyi`、`360`、`uc`、`wenshushu`、`xunlei`、`jianguo`、`yidong`、`onedrive`。

### 二、修改已有网盘图标

- **只更换图案：** 修改 `icons-netdisk.ts` 中对应标识的 SVG 内容，保持键名不变。
- **修改前台显示名称：** 修改 `client.ts` 中 `NETWORK_NAMES` 对应标识的文字，数据标识不变。
- **修改后台下拉显示名称：** 修改编辑器网盘类型选项中对应的 `label`，同时保留原来的 `value`。不要随意更改 `value`，否则历史文章中已保存的网盘类型可能无法匹配图标和名称。
- **修改 UI 通用图标：** `src/plugins/typecho-plugin-core-download/icons-ui.ts` 管理前台通用图标，目前包括 `open-link`、`warn_icon`、`front_logo`。替换时保留对应键名，避免影响打开链接、投诉提示和页脚标识。

`public/plugins/typecho-plugin-core-download/static/img/icon/` 中也存放了图标资源文件，但当前前台网盘卡片的图标实际由 `icons-netdisk.ts` 内联 SVG 映射提供。仅替换该目录里的同名文件，不会自动替换前台映射中的 SVG。

### 三、增加或修改插件全局设置项

当前后台全局设置页已有以下项目：

| 设置项 | 数据键 | 用途 |
| --- | --- | --- |
| 总开关 | `open` | 控制全站下载区域是否启用 |
| 主题颜色 | `theme_color` | 下载区域主题色 |
| 边框弧度 | `border_radius` | 下载卡片边框圆角 |
| 投诉地址 | `complaint_url` | 前台“投诉”入口链接 |
| 版权声明 | `copyright_str` | 下载区域底部版权文字 |

新增一个全局设置项时，需要让后台表单、后台读写、服务端默认值和前台使用保持一致。通常需要检查并同步以下文件：

1. **后台设置表单：** `src/plugins/typecho-plugin-core-download/admin.ts` 的 `coreDownloadSettingsPageHtml()`，增加表单控件及唯一的 DOM id。
2. **后台读取与提交：** `public/plugins/typecho-plugin-core-download/static/js/admin.js` 的 `initSettings()`，在读取设置时把数据键填入控件，并在保存请求的 JSON 中提交该键。
3. **服务端设置类型和默认值：** `src/plugins/typecho-plugin-core-download/service.ts` 的 `CoreDownloadSettings`、`getDefaultCoreDownloadSettings()` 和 `saveCoreDownloadSettings()`。新增类型字段、合理默认值，并在保存时按预期类型校验和写入。
4. **前台配置类型与实际效果：** 如果新设置会影响前台显示，还要在 `client.ts` 的 `MountConfig.settings` 中声明该字段，并在对应渲染逻辑中读取它。若只用于后台管理，则不需要为了形式而修改前台。
5. **样式：** 如果新选项控制视觉效果，再同步调整 `public/plugins/typecho-plugin-core-download/static/css/front.css` 或对应后台 CSS。

示例：新增一个布尔设置 `show_complaint`，默认值为 `true`。需要在后台增加开关控件，在 `admin.js` 读取并提交 `show_complaint`，在 `service.ts` 增加布尔类型、默认值和保存校验；如果它用于控制前台投诉入口，还要在 `client.ts` 根据该值决定是否创建投诉链接。只增加一个后台 HTML 控件是不够的：没有同步读写逻辑，设置就无法可靠保存和生效。

### 四、扩展后的检查清单

每次增加网盘类型、图标或设置项后，至少检查：

- 后台下拉选项能否看到并选中新增网盘；
- 保存文章后，`download_list[].name` 是否保存为预期标识；
- 重新编辑文章时，选中项是否能正确回显；
- 前台卡片是否同时显示正确的图标和名称；
- 原有网盘类型的图标、名称和历史文章是否不受影响；
- 新增全局设置能否读取、修改、保存，并在刷新后台后保持；
- 如果设置影响前台，分别检查开启和关闭两种状态。

**兼容性原则：** 已有网盘标识和已保存的数据键尽量保持稳定。新增选项时增加新键，不要通过重命名旧键来实现；确实需要改名时，必须同时考虑历史文章数据的兼容读取。
