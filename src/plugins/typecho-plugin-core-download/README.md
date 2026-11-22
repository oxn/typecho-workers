# CoreDownload 下载增强（Typecho Workers 移植）

本插件依据原版仓库 https://github.com/sbqtmd/core-download 的源码移植。前台结构与样式以原版 template/components/download-warp.php、template/components/download-url-item.php 和 static/css/front.css 为准；复制提取码交互使用原版 static/js/home.min.js。

## WordPress 数据兼容

文章级字段保持原版名称：core_download_meta_box。

字段值保持原版 Base64(JSON)，不改成 OXN 自定义格式。当前 OXN WordPress 导入器会把来源自定义字段暂存为 wordpress:字段名，因此插件读取时优先找 core_download_meta_box，其次兼容读取 wordpress:core_download_meta_box。导入器遇到同名多值时会保存 JSON 数组，插件按 WordPress get_post_meta(..., true) 的语义读取第一项。编辑并保存文章后，数据会写回原版字段名 core_download_meta_box，内部 Base64(JSON) 结构不变。

解码后的结构仍为：

{
  "open": true,
  "content": "Base64 编码的 HTML",
  "download_list": [
    {
      "name": "baidu",
      "key": "1234",
      "url": "https://example.com",
      "resource_name": "资源描述",
      "show_type": ""
    }
  ]
}

content 内部继续保存 Base64 编码的富文本 HTML；每条下载记录继续使用 name、key、url、resource_name、show_type。读取和后台保存时会保留原对象中的其他未知键，避免移植时丢失旧数据。

全局设置保持原版选项名 core_download_set，值也保持 Base64(JSON)。沿用原版设置键：need_update、open、last_update、complaint_url、theme_color、border_radius、copyright_str。现有 WXR 导入器不导入 WordPress 的 wp_options，因此全局设置不会随文章自动迁移；首次启用后需在插件设置页打开总开关并确认颜色等设置，不需要重新录入文章下载列表。

## 前台行为

- 只有插件启用、全局 open 为 true、文章 open 为 true 且 download_list 非空时才显示。
- 文章密码未解锁时不读取、不输出下载区域。
- 服务端只提供空挂载节点和配置数据；下载区域的可见 DOM 由浏览器端创建。
- 前台 DOM 结构和类名按原版两个 PHP 模板移植，前台 CSS 使用原版 front.css。
- 前台 SVG 图标直接使用原版 SVG 内容；提取码复制与成功/失败提示使用原版 home.min.js。

## 后台行为

- 文章下载列表编辑控件使用原版 editor.min.js；编辑数据写回 Typecho typecho_fields 表，字段名固定为 core_download_meta_box，类型为 str。
- 原版 WordPress TinyMCE 由 WordPress 核心提供，不属于插件源码；移植版保留原版下载列表编辑控件，用 contenteditable HTML 编辑区承接同一 content 字段。
- 编辑时解码原版 Base64(JSON)，保存时重新按原版格式编码；content 单独 Base64 编码 HTML。
- 全局设置保存在 typecho_options 的 core_download_set，仍为 Base64(JSON)。
- 原版 admin-set.min.js 依赖 WordPress AJAX 和插件更新接口；全局设置页按原版设置键实现，自动更新功能不移植。
- 原版源码未发现独立下载口令验证逻辑；本移植版不添加另一套口令验证。

## 原版文件对应

| WordPress 原版文件 | 移植用途 |
| --- | --- |
| core/Options.php | service.ts：字段名、Base64(JSON)、默认值及全局设置 |
| core/Plugin.php | index.ts、Post.astro：文章显示入口与启用条件 |
| template/components/download-warp.php | client.ts：前台下载区外层结构 |
| template/components/download-url-item.php | client.ts：网盘卡片结构 |
| static/css/front.css | public/plugins/typecho-plugin-core-download/static/css/front.css |
| static/js/home.min.js | public/plugins/typecho-plugin-core-download/static/js/home.min.js |
| static/js/editor.min.js | public/plugins/typecho-plugin-core-download/static/js/editor.min.js |
| static/css/admin.css | public/plugins/typecho-plugin-core-download/static/css/editor.css |
| static/img 中的 SVG 图标 | icons-netdisk.ts、icons-ui.ts 及 public 静态资源 |

