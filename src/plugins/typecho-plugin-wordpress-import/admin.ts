export function wordpressImportAdminPageHtml(csrfToken: string): string {
  return `<div class="col-mb-12" id="wordpress-import-app">
  <section class="typecho-post-area">
    <h2>导入 WordPress 内容</h2>
    <p>选择 WordPress 后台「工具 → 导出」生成的 WXR XML 文件。系统会在浏览器本地按文章依赖关系自动分割，再逐片分析和导入。</p>
    <form id="wordpress-import-form">
      <input type="hidden" name="_" value="${csrfToken}">
      <div class="typecho-option">
        <label for="wordpress-import-file">WordPress 导出文件（.xml）</label>
        <input id="wordpress-import-file" name="file" type="file" accept=".xml,application/xml,text/xml" required>
        <p class="description">原始文件在浏览器本地处理，不会整体上传。每个分片不超过 24 MB，目标大小约 4 MB。</p>
      </div>
      <fieldset class="wordpress-import-types">
        <legend>选择导入内容</legend>
        <label><input type="checkbox" name="contentTypes" value="post" checked> 文章</label>
        <label><input type="checkbox" name="contentTypes" value="page" checked> 页面</label>
        <label><input type="checkbox" name="contentTypes" value="note" checked> 笔记</label>
        <p class="description">默认全部导入。附件、评论及分类等关联数据会根据所选内容自动处理。</p>
      </fieldset>
      <fieldset class="wordpress-import-dedupe">
        <legend>重复判断方式</legend>
        <label><input type="checkbox" name="dedupeFields" value="title" checked> 标题</label>
        <label><input type="checkbox" name="dedupeFields" value="slug" checked> 别名</label>
        <label><input type="checkbox" name="dedupeFields" value="id" checked> ID</label>
        <p class="description">默认同时匹配标题、别名和 ID。勾选多项时，所选字段必须全部相同才会跳过；附件仍按来源站点和原 ID 识别。</p>
      </fieldset>
      <div class="wordpress-import-warning">
        默认增量导入，不会删除或覆盖现有文章。系统会按上方选择的字段判断重复内容。
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
.wordpress-import-types{margin:18px 0;padding:12px 14px;border:1px solid var(--border-color,#ddd);border-radius:3px}
.wordpress-import-types legend{padding:0 6px;font-weight:600}
.wordpress-import-types label{display:inline-flex;align-items:center;gap:6px;margin:4px 20px 4px 0;font-weight:400}
.wordpress-import-types input,.wordpress-import-dedupe input{margin:0}
.wordpress-import-dedupe{margin:18px 0;padding:12px 14px;border:1px solid var(--border-color,#ddd);border-radius:3px}
.wordpress-import-dedupe legend{padding:0 6px;font-weight:600}
.wordpress-import-dedupe label{display:inline-flex;align-items:center;gap:6px;margin:4px 20px 4px 0;font-weight:400}
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
  var typeInputs=Array.prototype.slice.call(form.querySelectorAll('input[name="contentTypes"]'));
  var dedupeInputs=Array.prototype.slice.call(form.querySelectorAll('input[name="dedupeFields"]'));
  var previewButton=document.getElementById('wordpress-import-preview');
  var importButton=document.getElementById('wordpress-import-confirm');
  var status=document.getElementById('wordpress-import-status');
  var reportBox=document.getElementById('wordpress-import-report');
  var lastPreview=null;
  function selectedTypes(){
    return typeInputs.filter(function(input){return input.checked;}).map(function(input){return input.value;}).sort();
  }
  function selectionKey(){return selectedTypes().join(',');}
  function selectedDedupeFields(){return dedupeInputs.filter(function(input){return input.checked;}).map(function(input){return input.value;}).sort();}
  function dedupeSelectionKey(){return selectedDedupeFields().join(',');}
  function setBusy(busy){
    previewButton.disabled=busy;
    fileInput.disabled=busy;
    typeInputs.forEach(function(input){input.disabled=busy;});
    dedupeInputs.forEach(function(input){input.disabled=busy;});
  }
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
  function splitWxr(xml,filename,selectedTypes){
    var documentNode=new DOMParser().parseFromString(xml,'application/xml');
    if(documentNode.getElementsByTagName('parsererror').length)throw new Error('XML 格式错误，浏览器无法安全解析此文件。');
    var rss=documentNode.documentElement;
    if(!rss||localName(rss)!=='rss')throw new Error('文件不是有效的 WordPress WXR（缺少 rss 根节点）。');
    var channel=directChild(rss,'channel');
    if(!channel)throw new Error('WordPress WXR 缺少 channel 节点。');
    var allItems=Array.prototype.filter.call(channel.children,function(node){return localName(node)==='item';});
    var selectedTypeSet=new Set(selectedTypes);
    var selectedContentItems=allItems.filter(function(item){return selectedTypeSet.has(childText(item,'post_type'));});
    var selectedContentIds=new Set(selectedContentItems.map(function(item){return parseInteger(childText(item,'post_id'));}).filter(Boolean));
    var attachmentIds=new Set();
    selectedContentItems.forEach(function(item){
      Array.prototype.filter.call(item.children,function(node){return localName(node)==='postmeta';}).forEach(function(meta){
        var key=childText(meta,'meta_key');
        if(key!=='_thumbnail_id'&&key!=='images'&&key!=='attachment')return;
        (childText(meta,'meta_value').match(/\\d+/g)||[]).forEach(function(rawId){
          var id=parseInteger(rawId);
          if(id)attachmentIds.add(id);
        });
      });
    });
    var addedAttachment=true;
    while(addedAttachment){
      addedAttachment=false;
      allItems.forEach(function(item){
        if(childText(item,'post_type')!=='attachment')return;
        var id=parseInteger(childText(item,'post_id'));
        var parentId=parseInteger(childText(item,'post_parent'));
        if(id&&!attachmentIds.has(id)&&(selectedContentIds.has(parentId)||attachmentIds.has(parentId))){
          attachmentIds.add(id);
          addedAttachment=true;
        }
      });
    }
    var items=allItems.filter(function(item){
      var type=childText(item,'post_type');
      return selectedTypeSet.has(type)||(type==='attachment'&&attachmentIds.has(parseInteger(childText(item,'post_id'))));
    });
    if(!items.length)throw new Error('WXR 文件中没有符合所选类型的文章、页面或笔记。');

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
        (value.match(/\\d+/g)||[]).forEach(function(rawId){
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
      var partFile=new File([partXml],filename.replace(/\\.xml$/i,'')+'-part-'+String(partIndex+1).padStart(3,'0')+'.xml',{type:'application/xml'});
      if(partFile.size>MAX_PART_BYTES)throw new Error('第 '+(partIndex+1)+' 个分片实际大小超过 24 MB。请在 WordPress 中按日期或内容类型分批导出。');
      return partFile;
    });
    return parts;
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
  function hasImportableItems(report){
    var imported=report&&report.imported||{};
    return Number(imported.posts||0)+Number(imported.pages||0)+Number(imported.notes||0)+Number(imported.attachments||0)>0;
  }
  function formatDuration(value){
    value=Number(value||0);
    return value<1000?Math.round(value)+' ms':(value/1000).toFixed(2)+' 秒';
  }
  function renderReport(data,partCount,isPreview){
    reportBox.replaceChildren();
    var title=document.createElement('h3');
    title.textContent=(data.siteTitle||'WordPress 网站')+(isPreview?'：分析预览（尚未导入）':'：本次导入结果');
    reportBox.appendChild(title);
    var list=document.createElement('ul');
    var selectedTypeByCount={posts:'post',pages:'page',notes:'note'};
    Object.keys(labels).forEach(function(key){
      var count=Number(data.imported&&data.imported[key]||0);
      if(!count&&(!selectedTypeByCount[key]||selectedTypes().indexOf(selectedTypeByCount[key])===-1))return;
      var item=document.createElement('li');
      item.textContent=(isPreview?'预计新增':'本次写入')+labels[key]+'：'+count+(isPreview&&key==='metas'?'（预估，跨分片可能重复）':'');
      list.appendChild(item);
    });
    if(data.alreadyImported){
      var skippedItem=document.createElement('li');
      skippedItem.textContent='数据库中已存在，本次跳过：'+data.alreadyImported;
      list.appendChild(skippedItem);
    }
    var partsItem=document.createElement('li');
    partsItem.textContent='XML 分片：'+partCount+' 个';
    list.appendChild(partsItem);
    if(!isPreview){
      var writeMetrics=data.databaseWrite||{rowsWritten:0,statementCount:0,batchDurationMs:0,sqlDurationMs:0};
      var writesItem=document.createElement('li');
      writesItem.textContent='D1 实际写入行数：'+Number(writeMetrics.rowsWritten||0);
      list.appendChild(writesItem);
      var statementsItem=document.createElement('li');
      statementsItem.textContent='SQL 语句数：'+Number(writeMetrics.statementCount||0);
      list.appendChild(statementsItem);
      var durationItem=document.createElement('li');
      durationItem.textContent='数据库批次耗时：'+formatDuration(writeMetrics.batchDurationMs);
      list.appendChild(durationItem);
      var sqlDurationItem=document.createElement('li');
      sqlDurationItem.textContent='SQL 执行耗时合计：'+formatDuration(writeMetrics.sqlDurationMs);
      list.appendChild(sqlDurationItem);
    }
    reportBox.appendChild(list);
    reportBox.hidden=false;
  }
  async function requestPart(file,action){
    var body=new FormData(form);
    body.delete('contentTypes');
    selectedTypes().forEach(function(type){body.append('contentTypes',type);});
    body.delete('dedupeFields');
    selectedDedupeFields().forEach(function(field){body.append('dedupeFields',field);});
    body.set('file',file,file.name);
    body.set('action',action);
    var response=await fetch('/api/admin/wordpress-import',{method:'POST',body:body,credentials:'same-origin'});
    var responseText=await response.text();
    var data=null;
    try{
      data=JSON.parse(responseText);
    }catch(parseError){
      var detail=responseText.replace(/<[^>]*>/g,' ').replace(/\\s+/g,' ').trim().slice(0,240);
      throw new Error(response.ok
        ? '服务器返回了无法识别的数据，请检查后台服务日志。'
        : '请求失败（HTTP '+response.status+'），服务器未返回有效 JSON。'+(detail?' '+detail:''));
    }
    if(!response.ok)throw new Error(data&&data.error||'请求失败（HTTP '+response.status+'）');
    if(!data||typeof data!=='object')throw new Error('服务器返回的数据格式不正确。');
    return data;
  }
  async function prepare(){
    var file=fileInput.files&&fileInput.files[0];
    if(!file){setStatus('请先选择 WordPress XML 文件。',true);return;}
    var chosenTypes=selectedTypes();
    if(!chosenTypes.length){setStatus('请至少选择一种导入内容类型。',true);return;}
    var chosenDedupeFields=selectedDedupeFields();
    if(!chosenDedupeFields.length){setStatus('请至少选择一种重复判断方式（标题、别名或 ID）。',true);return;}
    setBusy(true);
    importButton.disabled=true;
    lastPreview=null;
    reportBox.hidden=true;
    try{
      setStatus('正在读取原始 XML 并检查内容关联…');
      var sourceXml=await file.text();
      var parts=splitWxr(sourceXml,file.name,chosenTypes);
      var reports=[];
      for(var index=0;index<parts.length;index++){
        setStatus('正在分析分片 '+(index+1)+' / '+parts.length+'…');
        reports.push(await requestPart(parts[index],'preview'));
      }
      var combined=addReports(reports);
      renderReport(combined,parts.length,true);
      lastPreview={sourceXml:sourceXml,selection:chosenTypes.join(',')+'|'+chosenDedupeFields.join(','),parts:parts,reports:reports};
      var importable=Number(combined.imported.posts||0)+Number(combined.imported.pages||0)+Number(combined.imported.notes||0)+Number(combined.imported.attachments||0);
      importButton.disabled=importable===0;
      setStatus('分析完成：原文件已安全分为 '+parts.length+' 片。请核对合并统计，再确认导入。');
    }catch(error){
      setStatus(error instanceof Error?error.message:'XML 分割或分析失败',true);
    }finally{
      setBusy(false);
    }
  }
  async function importAll(){
    var file=fileInput.files&&fileInput.files[0];
    if(!file||!lastPreview){setStatus('请先重新分析文件。',true);return;}
    setBusy(true);
    importButton.disabled=true;
    var reports=[];
    try{
      var currentXml=await file.text();
      if(currentXml!==lastPreview.sourceXml)throw new Error('原始文件内容已变化，请重新分析。');
      if(selectionKey()+'|'+dedupeSelectionKey()!==lastPreview.selection)throw new Error('导入类型或重复判断方式已变化，请重新分析文件。');
      var confirmedParts=0;
      var skippedParts=0;
      for(var index=0;index<lastPreview.parts.length;index++){
        var previewReport=lastPreview.reports[index];
        if(!hasImportableItems(previewReport)){
          skippedParts++;
          reports.push({siteTitle:previewReport.siteTitle,totalItems:previewReport.totalItems,alreadyImported:previewReport.alreadyImported,imported:{},skipped:previewReport.skipped||{},databaseWrite:{rowsWritten:0,statementCount:0,batchDurationMs:0,sqlDurationMs:0}});
          renderReport(addReports(reports),lastPreview.parts.length,false);
          setStatus('已跳过已完成的第 '+(index+1)+' / '+lastPreview.parts.length+' 个分片…\\n已跳过 '+skippedParts+' 个，无需重复写入。');
          continue;
        }
        setStatus('正在导入第 '+(index+1)+' / '+lastPreview.parts.length+' 个分片…\\n已确认提交 '+confirmedParts+' 个，已跳过 '+skippedParts+' 个。当前分片只写入尚未成功导入的所选内容及其附件。');
        reports.push(await requestPart(lastPreview.parts[index],'import'));
        confirmedParts++;
        renderReport(addReports(reports),lastPreview.parts.length,false);
      }
      renderReport(addReports(reports),lastPreview.parts.length,false);
      lastPreview=null;
      setStatus('导入处理完成。新提交 '+confirmedParts+' 个分片，跳过已完成分片 '+skippedParts+' 个。');
    }catch(error){
      var completedRows=reports.reduce(function(total,report){return total+Number(report.databaseWrite&&report.databaseWrite.rowsWritten||0);},0);
      var progress=confirmedParts
        ? '\\n本次已确认提交 '+confirmedParts+' 个分片，D1 实际写入 '+completedRows+' 行。'
        : '\\n本次没有收到新的分片提交确认。';
      var skippedProgress=skippedParts?'\\n另有 '+skippedParts+' 个此前已完成的分片已安全跳过。':'';
      lastPreview=null;
      setStatus((error instanceof Error?error.message:'导入失败')+progress+skippedProgress+'\\n请重新选择同一原始文件并重新分析。系统会按当前选择的重复判断方式逐片核对数据库，从第一个仍有未导入内容的分片继续；分片内部也只写入尚未成功的文章。',true);
    }finally{
      setBusy(false);
      importButton.disabled=true;
    }
  }
  fileInput.addEventListener('change',function(){
    lastPreview=null;
    importButton.disabled=true;
    reportBox.hidden=true;
    setStatus('');
  });
  typeInputs.concat(dedupeInputs).forEach(function(input){
    input.addEventListener('change',function(){
      lastPreview=null;
      importButton.disabled=true;
      reportBox.hidden=true;
      setStatus('导入选项已改变，请重新分析文件。');
    });
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
