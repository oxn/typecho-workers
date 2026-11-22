export function coreDownloadAdminHtml(): string {
  return `<section id="core-download-editor" class="typecho-post-option" aria-label="CoreDownload 下载配置">
  <h3 class="typecho-label">CoreDownload 下载配置</h3>
  <p class="description">配置将保存到文章自定义字段 coreDownload。此面板只管理数据，前台样式与渲染将在后续阶段接入。</p>
  <p><label class="typecho-label" for="core-download-title">下载区标题</label><input id="core-download-title" class="text w-100" type="text" maxlength="120" placeholder="下载资源"></p>
  <p><label class="typecho-label" for="core-download-intro">顶部说明</label><textarea id="core-download-intro" class="w-100" rows="3" maxlength="5000" placeholder="下载前请阅读说明"></textarea></p>
  <div class="core-download-links-head"><strong>下载链接</strong><button type="button" class="btn btn-xs" id="core-download-add">+ 添加链接</button></div>
  <div id="core-download-links"></div>
  <p><label class="typecho-label" for="core-download-footer">底部说明</label><textarea id="core-download-footer" class="w-100" rows="3" maxlength="5000" placeholder="补充说明"></textarea></p>
  <p id="core-download-status" class="description" role="status" aria-live="polite"></p>
</section>
<style>
#core-download-editor{margin-top:18px;padding:14px;border:1px solid #e5e7eb;border-radius:3px;background:#fff}
#core-download-editor h3{margin:0 0 10px}
#core-download-editor .description{color:#8993a2;font-size:12px;line-height:1.6}
#core-download-editor input,#core-download-editor textarea{box-sizing:border-box}
#core-download-editor textarea{resize:vertical}
.core-download-links-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:14px 0 8px}
.core-download-link-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:8px 0;padding:10px;border:1px solid #edf0f4;border-radius:3px}
.core-download-link-row label{display:block;margin-bottom:4px;color:#667085;font-size:12px}
.core-download-link-row input{width:100%}
.core-download-link-row .core-download-link-actions{display:flex;align-items:center;justify-content:flex-end;grid-column:1/-1}
.core-download-link-row .core-download-remove{color:#a94442}
@media(max-width:600px){.core-download-link-row{grid-template-columns:minmax(0,1fr)}}
</style>
<script>
(function(){
  function init(){
    var panel=document.getElementById('core-download-editor');
    var form=document.forms.write_post;
    if(!panel||!form||panel.dataset.ready==='1')return;
    panel.dataset.ready='1';
    var title=panel.querySelector('#core-download-title');
    var intro=panel.querySelector('#core-download-intro');
    var footer=panel.querySelector('#core-download-footer');
    var list=panel.querySelector('#core-download-links');
    var status=panel.querySelector('#core-download-status');
    var fieldRow=null,fieldValue=null;
    var fields=document.querySelectorAll('#custom-field .field');
    fields.forEach(function(row){
      var name=row.querySelector('input[name="fieldNames[]"]');
      if(name&&name.value.trim()==='coreDownload'){fieldRow=row;fieldValue=row.querySelector('textarea');}
    });
    if(!fieldRow){
      fieldRow=document.createElement('li');
      fieldRow.className='field';
      fieldRow.innerHTML='<div class="field-name"><input type="text" name="fieldNames[]" value="coreDownload"><select class="field-type-select" name="fieldTypes[coreDownload]"><option value="str" selected>字符</option></select></div><div class="field-value"><textarea name="fieldValues[coreDownload]"></textarea></div>';
      document.querySelector('#custom-field .fields').appendChild(fieldRow);
      fieldValue=fieldRow.querySelector('textarea');
    }
    fieldRow.hidden=true;
    function addInput(row,label,key,value,type){
      var wrap=document.createElement('div');
      var caption=document.createElement('label');
      var input=document.createElement('input');
      caption.textContent=label;
      input.type=type||'text';
      input.value=value||'';
      input.dataset.key=key;
      input.addEventListener('input',sync);
      wrap.appendChild(caption);wrap.appendChild(input);row.appendChild(wrap);
    }
    function addLink(item){
      item=item||{};
      var row=document.createElement('div');
      row.className='core-download-link-row';
      addInput(row,'网盘名称','name',item.name);
      addInput(row,'下载地址','url',item.url,'url');
      addInput(row,'提取码','password',item.password);
      addInput(row,'备注','note',item.note);
      var actions=document.createElement('div');
      actions.className='core-download-link-actions';
      var remove=document.createElement('button');
      remove.type='button';remove.className='btn btn-xs core-download-remove';remove.textContent='删除此链接';
      remove.addEventListener('click',function(){row.remove();sync();});
      actions.appendChild(remove);row.appendChild(actions);list.appendChild(row);
    }
    function readLinks(){
      return Array.from(list.querySelectorAll('.core-download-link-row')).map(function(row){
        var item={};
        row.querySelectorAll('input[data-key]').forEach(function(input){item[input.dataset.key]=input.value.trim();});
        return item;
      }).filter(function(item){return item.name||item.url||item.password||item.note;});
    }
    function sync(){
      var data={version:1,title:title.value.trim(),intro:intro.value,links:readLinks(),footer:footer.value};
      fieldValue.value=JSON.stringify(data);
      status.textContent='配置已同步到文章自定义字段 coreDownload';
    }
    [title,intro,footer].forEach(function(input){input.addEventListener('input',sync);});
    panel.querySelector('#core-download-add').addEventListener('click',function(){addLink({});sync();});
    var existing={};
    try{existing=JSON.parse(fieldValue.value||'{}')||{};}catch(error){status.textContent='原有 coreDownload 字段不是有效 JSON，已保留原始值；修改面板后将按新格式保存。';}
    title.value=typeof existing.title==='string'?existing.title:'';
    intro.value=typeof existing.intro==='string'?existing.intro:'';
    footer.value=typeof existing.footer==='string'?existing.footer:'';
    if(Array.isArray(existing.links)){existing.links.forEach(addLink);}
    if(!list.children.length)addLink({});
    sync();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
</script>`;
}
