import type { PluginInitContext } from 'typecho/plugin-sdk';

const TEMPLATE_ID = 'friend-links';

function editorHtml(): string {
  return [
    '<section class="typecho-post-option oxn-friend-links-editor" data-oxn-friend-links-editor hidden>',
    '<label class="typecho-label">友情链接</label>',
    '<p class="description">按行维护友链。保存后写入页面自定义字段 <code>links</code>，格式兼容 WordPress Wing；页面正文仍独立保留在下方。</p>',
    '<div class="oxn-fl-table-wrap"><table class="oxn-fl-table">',
    '<thead><tr><th>网站名称</th><th>网站地址</th><th>网站简介</th><th>操作</th></tr></thead>',
    '<tbody data-oxn-fl-rows></tbody></table></div>',
    '<button type="button" class="btn btn-xs" data-oxn-fl-add>+ 添加友链</button>',
    '<span class="description" data-oxn-fl-count></span>',
    '</section>',
    '<style>',
    '.oxn-friend-links-editor{margin:12px 0}.oxn-friend-links-editor[hidden]{display:none!important}.oxn-fl-table-wrap{width:100%;overflow-x:auto;margin:10px 0}',
    '.oxn-fl-table{width:100%;min-width:560px;border-collapse:collapse}',
    '.oxn-fl-table th,.oxn-fl-table td{padding:7px;border:1px solid var(--border-color,#ddd);text-align:left;vertical-align:middle}',
    '.oxn-fl-table th{font-weight:600;white-space:nowrap}.oxn-fl-table input{box-sizing:border-box;width:100%;min-width:0}',
    '.oxn-fl-table td:last-child{width:54px;text-align:center}.oxn-fl-remove{white-space:nowrap}',
    '.oxn-friend-links-editor [data-oxn-fl-count]{margin-left:8px}',
    '</style>',
    '<script>(function(){',
    'var root=document.querySelector("[data-oxn-friend-links-editor]");if(!root||root.dataset.ready==="1")return;root.dataset.ready="1";',
    'var form=document.forms.namedItem("write_page"),template=document.getElementById("template"),tbody=root.querySelector("[data-oxn-fl-rows]"),count=root.querySelector("[data-oxn-fl-count]");',
    'if(!form||!template||!tbody)return;',
    'function updateCount(){count.textContent=tbody.querySelectorAll("tr").length+" 条友链";}',
    'function addRow(item){item=item||{};var tr=document.createElement("tr");',
    '[["name","网站名称"],["url","https://example.com"],["description","网站简介"]].forEach(function(field){',
    'var td=document.createElement("td"),input=document.createElement("input");input.type="text";input.dataset.field=field[0];input.placeholder=field[1];input.value=typeof item[field[0]]==="string"?item[field[0]]:"";td.appendChild(input);tr.appendChild(td);});',
    'var action=document.createElement("td"),remove=document.createElement("button");remove.type="button";remove.className="btn btn-xs oxn-fl-remove";remove.textContent="删除";',
    'remove.addEventListener("click",function(){tr.remove();updateCount();});action.appendChild(remove);tr.appendChild(action);tbody.appendChild(tr);updateCount();}',
    'function readExisting(){var value="",names=Array.from(form.querySelectorAll('input[name="fieldNames[]"]')),nameInput=names.find(function(input){return input.value.trim()==="links";});',
    'if(nameInput){var row=nameInput.closest(".field"),textarea=row&&row.querySelector("textarea");if(textarea)value=textarea.value;}if(!value)return [];',
    'try{var parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.filter(function(item){return item&&typeof item==="object"&&!Array.isArray(item);}):[];}catch(_){return [];}}',
    'function syncField(){var data=Array.from(tbody.querySelectorAll("tr")).map(function(tr){function get(key){var input=tr.querySelector('[data-field="'+key+'"]');return input?input.value.trim():"";}',
    'return {name:get("name"),url:get("url"),description:get("description")};}).filter(function(item){return item.name||item.url||item.description;});',
    'var names=Array.from(form.querySelectorAll('input[name="fieldNames[]"]')),nameInput=names.find(function(input){return input.value.trim()==="links";}),fieldRow=nameInput&&nameInput.closest(".field");',
    'if(!fieldRow){var fields=form.querySelector("#custom-field .fields");if(!fields)return;fieldRow=document.createElement("li");fieldRow.className="field";fieldRow.hidden=true;',
    'fieldRow.innerHTML='<div class="field-name"><input type="text" name="fieldNames[]" value="links"></div><input type="hidden" name="fieldTypes[links]" value="str"><textarea name="fieldValues[links]"></textarea>';fields.appendChild(fieldRow);}',
    'var type=fieldRow.querySelector('select[name="fieldTypes[links]"],input[name="fieldTypes[links]"]');if(type)type.value="str";',
    'var value=fieldRow.querySelector('textarea[name="fieldValues[links]"]');if(!value){value=document.createElement("textarea");value.name="fieldValues[links]";fieldRow.appendChild(value);}value.value=JSON.stringify(data);}',
    'var existing=readExisting();if(existing.length)existing.forEach(addRow);else addRow({});',
    'root.querySelector("[data-oxn-fl-add]").addEventListener("click",function(){addRow({});});',
    'function updateVisibility(){root.hidden=template.value!=="friend-links";}template.addEventListener("change",updateVisibility);updateVisibility();',
    'form.addEventListener("submit",function(){if(template.value==="friend-links")syncField();},true);',
    '})();</script>'
  ].join('');
}

export default function init({ addHook, HookPoints, pluginId }: PluginInitContext): void {
  addHook(HookPoints['admin:writePage:option'], pluginId, (html: string) => html + editorHtml());
}
