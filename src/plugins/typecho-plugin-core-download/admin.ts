function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
}

const ADMIN_CSS = '<link rel="stylesheet" href="/__plugin-assets/typecho-plugin-core-download/css/admin.css">';
const ADMIN_JS = '<script src="/__plugin-assets/typecho-plugin-core-download/js/admin.js"></script>';

export function coreDownloadSettingsPageHtml(csrfToken: string): string {
  return ADMIN_CSS +
    '<section class="core-download-settings" id="core-download-settings" data-csrf="' + escapeHtml(csrfToken) + '">' +
    '<header class="core-download-settings__header"><h2>CoreDownload 下载增强</h2><p>全局设置沿用 WordPress 原版 core_download_set 字段及 Base64(JSON) 存储格式。</p></header>' +
    '<div class="core-download-settings__body">' +
    '<label class="core-download-settings__row"><span><strong>总开关</strong><small>开启以后，网站所有文章的下载设置才生效</small></span><input type="checkbox" id="core-download-setting-open"></label>' +
    '<label class="core-download-settings__row"><span><strong>主题颜色</strong></span><input type="color" id="core-download-setting-color" value="#409EFF"></label>' +
    '<label class="core-download-settings__row"><span><strong>边框弧度</strong><small>原版默认值为 8</small></span><input type="text" id="core-download-setting-radius" value="8"></label>' +
    '<label class="core-download-settings__row"><span><strong>投诉地址</strong><small>前台下载区域右上角“投诉”的跳转地址</small></span><input type="url" id="core-download-setting-complaint" placeholder="https://"></label>' +
    '<label class="core-download-settings__row"><span><strong>版权声明</strong></span><textarea id="core-download-setting-copyright" rows="3"></textarea></label>' +
    '<div class="core-download-settings__actions"><button type="button" class="btn primary" id="core-download-setting-save">保存</button><button type="button" class="btn" id="core-download-setting-reset-color">恢复默认颜色</button><span id="core-download-setting-notice" role="status"></span></div>' +
    '</div>' +
    '<section class="core-download-settings__about"><h3>关于 CoreDownload</h3><p>原版作者：Applek（果核剥壳）</p>' +
    '<p><a href="https://www.lovestu.com/coredownload.html" target="_blank" rel="noopener noreferrer">插件主页</a> · <a href="https://www.yuque.com/applek/coredownload" target="_blank" rel="noopener noreferrer">使用文档</a></p>' +
    '<p>原版自动更新功能依赖 WordPress 插件更新接口及文件系统覆盖，不适用于 Workers；此移植版不执行远程下载或自动更新。</p></section>' +
    '</section>' + ADMIN_JS;
}

export function coreDownloadPostEditorHtml(): string {
  return ADMIN_CSS +
    '<link rel="stylesheet" href="/__plugin-assets/typecho-plugin-core-download/css/editor.css">' +
    '<div id="core-download-meta-box"></div>' +
    '<div id="wp-core_download_content-wrap" class="core-download-content-source">' +
    '<div class="core-download-content-toolbar" id="core-download-content-toolbar">' +
    '<button type="button" data-command="bold"><strong>B</strong></button><button type="button" data-command="underline"><u>U</u></button>' +
    '<button type="button" data-command="blockquote">引用</button><button type="button" data-command="justifyLeft">左对齐</button>' +
    '<button type="button" data-command="justifyCenter">居中</button><button type="button" data-command="justifyRight">右对齐</button>' +
    '<button type="button" data-command="createLink">链接</button><button type="button" data-command="unlink">取消链接</button>' +
    '<button type="button" data-command="insertUnorderedList">• 列表</button><button type="button" data-command="insertOrderedList">1. 列表</button>' +
    '<button type="button" data-command="undo">撤销</button><button type="button" data-command="redo">重做</button>' +
    '<button type="button" id="core-download-content-fullscreen">全屏</button>' +
    '<label title="文字颜色"><input type="color" id="core-download-content-color"></label></div>' +
    '<div id="core_download_content" class="core-download-content-editor" contenteditable="true" role="textbox" aria-multiline="true"></div></div>' +
    ADMIN_JS +
    '<script defer src="/__plugin-assets/typecho-plugin-core-download/js/editor.min.js"></script>';
}
