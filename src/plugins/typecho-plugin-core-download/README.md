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

