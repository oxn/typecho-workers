export function wordpressImportAdminPageHtml(csrfToken: string): string {
  return `<div class="col-mb-12" id="wordpress-import-app">
  <section class="typecho-post-area">
    <h2>导入 WordPress 文章</h2>
    <p>选择 WordPress 后台「工具 → 导出」生成的 WXR XML 文件。系统会先分析文件，确认后再写入当前站点。</p>
    <form id="wordpress-import-form">
      <input type="hidden" name="_" value="${csrfToken}">
      <div class="typecho-option">
        <label for="wordpress-import-file">WordPress 导出文件（.xml）</label>
        <input id="wordpress-import-file" name="file" type="file" accept=".xml,application/xml,text/xml" required>
        <p class="description">单个文件最大 25 MB。较大的站点请在 WordPress 中分批导出。</p>
      </div>
      <div class="wordpress-import-warning">
        默认增量导入，不会删除或覆盖现有文章。已导入过的 WordPress 内容会按原文章 ID 自动跳过。
        发布状态会按 WordPress 原状态保留；公开文章导入后会出现在本站前台。
      </div>
      <p class="description">目前保留正文中的原始媒体地址，不会自动把 WordPress 图片和附件文件复制到本站 R2。</p>
      <div class="wordpress-import-actions">
        <button type="button" class="btn" id="wordpress-import-preview">分析文件</button>
        <button type="button" class="btn primary" id="wordpress-import-confirm" disabled>确认导入</button>
      </div>
    </form>
    <div id="wordpress-import-status" role="status" aria-live="polite"></div>
    <div id="wordpress-import-report" hidden></div>
  </section>
</div>
<style>
#wordpress-import-app{max-width:900px}
#wordpress-import-app h2{margin:0 0 14px;font-size:1.25em;font-weight:600}
#wordpress-import-app p{line-height:1.7}
#wordpress-import-app .typecho-option{margin:20px 0}
#wordpress-import-app .typecho-option label{display:block;margin-bottom:8px;font-weight:600}
#wordpress-import-app input[type=file]{display:block;max-width:100%;padding:8px;border:1px solid var(--border-color,#ddd);border-radius:3px;background:var(--background,#fff)}
#wordpress-import-app .description{margin:7px 0;color:var(--description-color,#888);font-size:.92em}
.wordpress-import-warning{margin:18px 0;padding:12px 14px;border-left:3px solid #c99b43;background:rgba(201,155,67,.09);line-height:1.7}
.wordpress-import-actions{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}
.wordpress-import-actions button:disabled{opacity:.45;cursor:not-allowed}
#wordpress-import-status{margin:14px 0;line-height:1.7}
#wordpress-import-status.error{color:#b33}
#wordpress-import-report{margin-top:16px;padding:14px;border:1px solid var(--border-color,#ddd);border-radius:3px}
#wordpress-import-report h3{margin:0 0 10px;font-size:1.05em}
#wordpress-import-report ul{margin:8px 0;padding-left:22px;line-height:1.8}
@media(prefers-color-scheme:dark){#wordpress-import-app input[type=file]{background:var(--background,#222);color:inherit}}
</style>
<script>
(function(){
  var form=document.getElementById('wordpress-import-form');
  if(!form||form.dataset.ready)return;
  form.dataset.ready='1';
  var fileInput=document.getElementById('wordpress-import-file');
  var previewButton=document.getElementById('wordpress-import-preview');
  var importButton=document.getElementById('wordpress-import-confirm');
  var status=document.getElementById('wordpress-import-status');
  var reportBox=document.getElementById('wordpress-import-report');
  var lastPreview=null;
  function setStatus(message,error){
    status.textContent=message;
    status.className=error?'error':'';
  }
  function renderReport(data){
    reportBox.replaceChildren();
    var title=document.createElement('h3');
    title.textContent=(data.siteTitle||'WordPress 网站')+'：导入统计';
    reportBox.appendChild(title);
    var list=document.createElement('ul');
    var labels={posts:'文章',pages:'独立页面',notes:'笔记',attachments:'附件记录',comments:'评论',metas:'新建分类/标签',relationships:'内容关联',media:'媒体文件'};
    Object.keys(labels).forEach(function(key){
      var count=Number(data.imported&&data.imported[key]||0);
      if(!count)return;
      var item=document.createElement('li');
      item.textContent=labels[key]+'：'+count;
      list.appendChild(item);
    });
    var skipped=Number(data.alreadyImported||0);
    if(skipped){
      var skippedItem=document.createElement('li');
      skippedItem.textContent='已导入并跳过：'+skipped;
      list.appendChild(skippedItem);
    }
    reportBox.appendChild(list);
    reportBox.hidden=false;
  }
  async function submit(action){
    var file=fileInput.files&&fileInput.files[0];
    if(!file){setStatus('请先选择 WordPress XML 文件。',true);return;}
    var body=new FormData(form);
    body.set('action',action);
    previewButton.disabled=true;
    importButton.disabled=true;
    setStatus(action==='preview'?'正在分析 XML 文件…':'正在导入，请勿关闭页面…');
    try{
      var response=await fetch('/api/admin/wordpress-import',{method:'POST',body:body,credentials:'same-origin'});
      var data=await response.json();
      if(!response.ok)throw new Error(data.error||'请求失败（HTTP '+response.status+'）');
      renderReport(data);
      if(action==='preview'){
        lastPreview={name:file.name,size:file.size};
        importButton.disabled=Number(data.imported&&data.imported.posts||0)+Number(data.imported&&data.imported.pages||0)+Number(data.imported&&data.imported.notes||0)+Number(data.imported&&data.imported.attachments||0)===0;
        setStatus('分析完成。请核对统计结果，再点击「确认导入」。');
      }else{
        lastPreview=null;
        setStatus('导入完成。已写入 '+Object.values(data.imported||{}).reduce(function(a,b){return a+Number(b||0);},0)+' 项记录。');
      }
    }catch(error){
      setStatus(error instanceof Error?error.message:'导入失败',true);
    }finally{
      previewButton.disabled=false;
      if(action==='import')importButton.disabled=true;
    }
  }
  fileInput.addEventListener('change',function(){
    lastPreview=null;
    importButton.disabled=true;
    reportBox.hidden=true;
    setStatus('');
  });
  previewButton.addEventListener('click',function(){submit('preview');});
  importButton.addEventListener('click',function(){
    var file=fileInput.files&&fileInput.files[0];
    if(!lastPreview||!file||lastPreview.name!==file.name||lastPreview.size!==file.size){
      setStatus('文件已变化，请重新分析。',true);
      importButton.disabled=true;
      return;
    }
    if(window.confirm('确认将此 WordPress 导出文件导入当前站点吗？此操作会新增内容，但不会删除现有内容。')){
      submit('import');
    }
  });
})();
</script>`;
}
