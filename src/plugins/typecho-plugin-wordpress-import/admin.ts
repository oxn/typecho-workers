export function wordpressImportAdminPageHtml(csrfToken: string): string {
  return `<div class="col-mb-12" id="wordpress-import-app">
  <section class="typecho-post-area">
    <h2>导入 WordPress 文章</h2>
    <p>选择 WordPress 后台「工具 → 导出」生成的 WXR XML 文件。系统会在浏览器本地按文章依赖关系自动分割，再逐片分析和导入。</p>
    <form id="wordpress-import-form">
      <input type="hidden" name="_" value="${csrfToken}">
      <div class="typecho-option">
        <label for="wordpress-import-file">WordPress 导出文件（.xml）</label>
        <input id="wordpress-import-file" name="file" type="file" accept=".xml,application/xml,text/xml" required>
        <p class="description">原始文件在浏览器本地处理，不会整体上传。每个分片不超过 24 MB，目标大小约 4 MB。</p>
      </div>
      <div class="wordpress-import-warning">
        默认增量导入，不会删除或覆盖现有文章。已导入过的 WordPress 内容会按来源站点地址和原文章 ID 自动跳过。
        发布状态会按 WordPress 原状态保留；公开文章导入后会出现在本站前台。
      </div>
      <p class="description">分割会保持文章与评论、页面父子关系及文章引用附件的关联。正文中的原始媒体地址仍会保留，不会自动复制到本站 R2。</p>
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
#wordpress-import-status{margin:14px 0;line-height:1.7;white-space:pre-line}
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
  var TARGET_BYTES=4*1024*1024;
  var MAX_PART_BYTES=24*1024*1024;
  var labels={posts:'文章',pages:'独立页面',notes:'笔记',attachments:'附件记录',comments:'评论',metas:'新建分类/标签',relationships:'内容关联',media:'媒体文件'};

  function setStatus(message,error){
    status.textContent=message;
    status.className=error?'error':'';
  }
  function localName(node){
    return node.localName||String(node.nodeName||'').split(':').pop();
  }
  function directChild(node,name){
    return Array.prototype.find.call(node.children||[],function(child){return localName(child)===name;})||null;
  }
  function childText(node,name){
    var child=directChild(node,name);
    return child?child.textContent.trim():'';
  }
  function parseInteger(value){
    var number=Number.parseInt(value,10);
    return Number.isSafeInteger(number)&&number>0?number:0;
  }
  function splitWxr(xml,filename){
    var documentNode=new DOMParser().parseFromString(xml,'application/xml');
    if(documentNode.getElementsByTagName('parsererror').length)throw new Error('XML 格式错误，浏览器无法安全解析此文件。');
    var rss=documentNode.documentElement;
    if(!rss||localName(rss)!=='rss')throw new Error('文件不是有效的 WordPress WXR（缺少 rss 根节点）。');
    var channel=directChild(rss,'channel');
    if(!channel)throw new Error('WordPress WXR 缺少 channel 节点。');
    var items=Array.prototype.filter.call(channel.children,function(node){return localName(node)==='item';});
    if(!items.length)throw new Error('WXR 文件中没有可导入的 item 文章节点。');

    var idToIndex=new Map();
    var itemIds=[];
    items.forEach(function(item,index){
      var id=parseInteger(childText(item,'post_id'));
      if(id&&idToIndex.has(id))throw new Error('WXR 中存在重复的 WordPress 内容 ID：'+id);
      itemIds.push(id);
      if(id)idToIndex.set(id,index);
    });

    var parents=items.map(function(_,index){return index;});
    function find(index){
      while(parents[index]!==index){parents[index]=parents[parents[index]];index=parents[index];}
      return index;
    }
    function unite(a,b){
      var ra=find(a),rb=find(b);
      if(ra!==rb)parents[rb]=ra;
    }
    items.forEach(function(item,index){
      var parentId=parseInteger(childText(item,'post_parent'));
      if(parentId&&idToIndex.has(parentId))unite(index,idToIndex.get(parentId));
      var metas=Array.prototype.filter.call(item.children,function(node){return localName(node)==='postmeta';});
      metas.forEach(function(meta){
        var key=childText(meta,'meta_key');
        if(key!=='_thumbnail_id'&&key!=='images'&&key!=='attachment')return;
        var value=childText(meta,'meta_value');
        (value.match(/\d+/g)||[]).forEach(function(rawId){
          var referencedId=parseInteger(rawId);
          if(referencedId&&idToIndex.has(referencedId))unite(index,idToIndex.get(referencedId));
        });
      });
    });

    var components=new Map();
    items.forEach(function(item,index){
      var root=find(index);
      if(!components.has(root))components.set(root,[]);
      components.get(root).push(index);
    });
    var serializer=new XMLSerializer();
    var baseDocument=documentNode.cloneNode(true);
    var baseChannel=directChild(baseDocument.documentElement,'channel');
    Array.prototype.slice.call(baseChannel.children).forEach(function(node){
      if(localName(node)==='item')baseChannel.removeChild(node);
    });
    var baseBytes=new Blob([serializer.serializeToString(baseDocument)]).size;
    if(baseBytes+512>MAX_PART_BYTES)throw new Error('WXR 的全局作者/分类等定义本身已超过单片 24 MB，无法安全分割。');

    var itemBytes=items.map(function(item){return new Blob([serializer.serializeToString(item)]).size;});
    var groups=[];
    var current=[];
    var currentSize=baseBytes+512;
    Array.from(components.values()).forEach(function(component){
      var componentSize=component.reduce(function(total,index){return total+itemBytes[index];},0);
      if(baseBytes+512+componentSize>MAX_PART_BYTES){
        throw new Error('文章 ID '+(itemIds[component[0]]||'(未知)')+' 所在的关联内容组超过 24 MB。为避免拆断附件或父子关系，系统不会强行拆开该组。');
      }
      if(current.length&&currentSize+componentSize>TARGET_BYTES){
        groups.push(current);
        current=[];
        currentSize=baseBytes+512;
      }
      component.forEach(function(index){current.push(index);});
      currentSize+=componentSize;
    });
    if(current.length)groups.push(current);

    var parts=groups.map(function(indexes,partIndex){
      var partDocument=baseDocument.cloneNode(true);
      var partChannel=directChild(partDocument.documentElement,'channel');
      indexes.sort(function(a,b){return a-b;}).forEach(function(index){
        partChannel.appendChild(partDocument.importNode(items[index],true));
      });
      var partXml=serializer.serializeToString(partDocument);
      var partFile=new File([partXml],filename.replace(/\.xml$/i,'')+'-part-'+String(partIndex+1).padStart(3,'0')+'.xml',{type:'application/xml'});
      if(partFile.size>MAX_PART_BYTES)throw new Error('第 '+(partIndex+1)+' 个分片实际大小超过 24 MB。请在 WordPress 中按日期或内容类型分批导出。');
      return partFile;
    });
    return parts;
  }

  async function fingerprint(file){
    if(!window.crypto||!crypto.subtle)throw new Error('当前浏览器不支持文件校验，请使用最新版浏览器和 HTTPS 后台。');
    var digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map(function(byte){return byte.toString(16).padStart(2,'0');}).join('');
  }
  function addReports(reports){
    var result={siteTitle:reports[0].siteTitle,totalItems:0,alreadyImported:0,imported:{},skipped:{}};
    var databaseWrite={rowsWritten:0,statementCount:0,batchDurationMs:0,sqlDurationMs:0};
    var hasDatabaseWrite=false;
    reports.forEach(function(report){
      result.totalItems+=Number(report.totalItems||0);
      result.alreadyImported+=Number(report.alreadyImported||0);
      Object.keys(report.imported||{}).forEach(function(key){result.imported[key]=(result.imported[key]||0)+Number(report.imported[key]||0);});
      Object.keys(report.skipped||{}).forEach(function(key){result.skipped[key]=(result.skipped[key]||0)+Number(report.skipped[key]||0);});
      if(report.databaseWrite){
        hasDatabaseWrite=true;
        databaseWrite.rowsWritten+=Number(report.databaseWrite.rowsWritten||0);
        databaseWrite.statementCount+=Number(report.databaseWrite.statementCount||0);
        databaseWrite.batchDurationMs+=Number(report.databaseWrite.batchDurationMs||0);
        databaseWrite.sqlDurationMs+=Number(report.databaseWrite.sqlDurationMs||0);
      }
    });
    if(hasDatabaseWrite)result.databaseWrite=databaseWrite;
    return result;
  }
  function formatDuration(value){
    value=Number(value||0);
    return value<1000?Math.round(value)+' ms':(value/1000).toFixed(2)+' 秒';
  }
  function renderReport(data,partCount,isPreview){
    reportBox.replaceChildren();
    var title=document.createElement('h3');
    title.textContent=(data.siteTitle||'WordPress 网站')+'：导入统计';
    reportBox.appendChild(title);
    var list=document.createElement('ul');
    Object.keys(labels).forEach(function(key){
      var count=Number(data.imported&&data.imported[key]||0);
      if(!count)return;
      var item=document.createElement('li');
      item.textContent=labels[key]+'：'+count+(isPreview&&key==='metas'?'（预估，跨分片可能重复）':'');
      list.appendChild(item);
    });
    if(data.alreadyImported){
      var skippedItem=document.createElement('li');
      skippedItem.textContent='已导入并跳过：'+data.alreadyImported;
      list.appendChild(skippedItem);
    }
    var partsItem=document.createElement('li');
    partsItem.textContent='XML 分片：'+partCount+' 个';
    list.appendChild(partsItem);
    if(!isPreview&&data.databaseWrite){
      var writesItem=document.createElement('li');
      writesItem.textContent='D1 实际写入行数：'+Number(data.databaseWrite.rowsWritten||0);
      list.appendChild(writesItem);
      var statementsItem=document.createElement('li');
      statementsItem.textContent='SQL 语句数：'+Number(data.databaseWrite.statementCount||0);
      list.appendChild(statementsItem);
      var durationItem=document.createElement('li');
      durationItem.textContent='数据库批次耗时：'+formatDuration(data.databaseWrite.batchDurationMs);
      list.appendChild(durationItem);
      var sqlDurationItem=document.createElement('li');
      sqlDurationItem.textContent='SQL 执行耗时合计：'+formatDuration(data.databaseWrite.sqlDurationMs);
      list.appendChild(sqlDurationItem);
    }
    reportBox.appendChild(list);
    reportBox.hidden=false;
  }
  async function requestPart(file,action){
    var body=new FormData(form);
    body.set('file',file,file.name);
    body.set('action',action);
    var response=await fetch('/api/admin/wordpress-import',{method:'POST',body:body,credentials:'same-origin'});
    var data=await response.json();
    if(!response.ok)throw new Error(data.error||'请求失败（HTTP '+response.status+'）');
    return data;
  }
  async function prepare(){
    var file=fileInput.files&&fileInput.files[0];
    if(!file){setStatus('请先选择 WordPress XML 文件。',true);return;}
    previewButton.disabled=true;
    importButton.disabled=true;
    fileInput.disabled=true;
    lastPreview=null;
    reportBox.hidden=true;
    try{
      setStatus('正在读取原始 XML 并检查文章关联…');
      var sourceXml=await file.text();
      var parts=splitWxr(sourceXml,file.name);
      var hash=await fingerprint(file);
      var reports=[];
      for(var index=0;index<parts.length;index++){
        setStatus('正在分析分片 '+(index+1)+' / '+parts.length+'…');
        reports.push(await requestPart(parts[index],'preview'));
      }
      var combined=addReports(reports);
      renderReport(combined,parts.length,true);
      lastPreview={hash:hash,parts:parts};
      var importable=Number(combined.imported.posts||0)+Number(combined.imported.pages||0)+Number(combined.imported.notes||0)+Number(combined.imported.attachments||0);
      importButton.disabled=importable===0;
      setStatus('分析完成：原文件已安全分为 '+parts.length+' 片。请核对合并统计，再确认导入。');
    }catch(error){
      setStatus(error instanceof Error?error.message:'XML 分割或分析失败',true);
    }finally{
      previewButton.disabled=false;
      fileInput.disabled=false;
    }
  }
  async function importAll(){
    var file=fileInput.files&&fileInput.files[0];
    if(!file||!lastPreview){setStatus('请先重新分析文件。',true);return;}
    previewButton.disabled=true;
    importButton.disabled=true;
    fileInput.disabled=true;
    var reports=[];
    try{
      var hash=await fingerprint(file);
      if(hash!==lastPreview.hash)throw new Error('原始文件内容已变化，请重新分析。');
      for(var index=0;index<lastPreview.parts.length;index++){
        setStatus('正在导入第 '+(index+1)+' / '+lastPreview.parts.length+' 个分片…\n已完成 '+index+' / '+lastPreview.parts.length+' 个。');
        reports.push(await requestPart(lastPreview.parts[index],'import'));
        renderReport(addReports(reports),lastPreview.parts.length,false);
      }
      lastPreview=null;
      setStatus('全部导入完成。共成功处理 '+reports.length+' 个分片。');
    }catch(error){
      var completed=reports.length;
      var completedRows=reports.reduce(function(total,report){return total+Number(report.databaseWrite&&report.databaseWrite.rowsWritten||0);},0);
      lastPreview=null;
      var progress=completed
        ? '\n已确认提交 '+completed+' 个分片，D1 实际写入 '+completedRows+' 行。'
        : '\n目前没有收到已成功提交分片的确认。';
      setStatus((error instanceof Error?error.message:'导入失败')+progress+'\n请重新选择同一原始文件并重新分析；系统会根据来源站点和 WordPress 原文章 ID 核对已写入内容，再跳过已导入记录。若是网络中断导致响应丢失，失败分片的最终提交状态也会通过重新分析核实。',true);
    }finally{
      previewButton.disabled=false;
      importButton.disabled=true;
      fileInput.disabled=false;
    }
  }
  fileInput.addEventListener('change',function(){
    lastPreview=null;
    importButton.disabled=true;
    reportBox.hidden=true;
    setStatus('');
  });
  previewButton.addEventListener('click',prepare);
  importButton.addEventListener('click',function(){
    if(!lastPreview){setStatus('请先分析原始文件。',true);return;}
    if(window.confirm('确认按分片顺序导入此 WordPress 文件吗？此操作只新增内容，不会删除或覆盖现有内容。')){
      importAll();
    }
  });
})();
</script>`;
}
