(function(){
  function initSettings(){
    var root=document.getElementById('core-download-settings');
    if(!root||root.dataset.ready==='1')return;
    root.dataset.ready='1';
    var token=root.dataset.csrf||'';
    var open=document.getElementById('core-download-setting-open');
    var color=document.getElementById('core-download-setting-color');
    var radius=document.getElementById('core-download-setting-radius');
    var complaint=document.getElementById('core-download-setting-complaint');
    var copyrightText=document.getElementById('core-download-setting-copyright');
    var save=document.getElementById('core-download-setting-save');
    var notice=document.getElementById('core-download-setting-notice');
    function tell(message,error){notice.textContent=message;notice.style.color=error?'#c33':'#39834a'}
    fetch('/api/admin/core-download').then(function(response){
      if(!response.ok)throw new Error('读取设置失败');
      return response.json();
    }).then(function(data){
      var set=data.settings||{};
      open.checked=!!set.open;
      color.value=/^#[0-9a-f]{6}$/i.test(set.theme_color||'')?set.theme_color:'#409EFF';
      radius.value=set.border_radius==null?'8':String(set.border_radius);
      complaint.value=set.complaint_url||'';
      copyrightText.value=set.copyright_str||'';
    }).catch(function(error){tell(error.message||'读取设置失败',true)});
    document.getElementById('core-download-setting-reset-color').addEventListener('click',function(){color.value='#409EFF'});
    save.addEventListener('click',async function(){
      save.disabled=true;tell('正在保存…',false);
      try{
        var response=await fetch('/api/admin/core-download',{
          method:'POST',
          headers:{'Content-Type':'application/json','X-CSRF-Token':token},
          body:JSON.stringify({
            open:open.checked,
            theme_color:color.value,
            border_radius:radius.value,
            complaint_url:complaint.value,
            copyright_str:copyrightText.value
          })
        });
        var data=await response.json();
        if(!response.ok||data.success===false)throw new Error(data.error||'保存失败');
        tell('保存成功',false);
      }catch(error){tell(error.message||'保存失败',true)}
      finally{save.disabled=false}
    });
  }

  function initPostEditor(){
    var root=document.getElementById('core-download-meta-box');
    if(!root||root.dataset.ready==='1')return;
    root.dataset.ready='1';
    var form=root.closest('form');
    if(!form)return;
    var fieldName='core_download_meta_box';
    var nameInput=Array.from(form.querySelectorAll('input[name="fieldNames[]"]')).find(function(input){return input.value===fieldName});
    var valueInput=form.querySelector('textarea[name="fieldValues[core_download_meta_box]"]');
    var typeInput=form.querySelector('[name="fieldTypes[core_download_meta_box]"]');
    var importedNameInput=Array.from(form.querySelectorAll('input[name="fieldNames[]"]')).find(function(input){return input.value==='wordpress:core_download_meta_box'});
    var importedValueInput=form.querySelector('textarea[name="fieldValues[wordpress:core_download_meta_box]"]');
    var importedRawValue=importedValueInput?importedValueInput.value.trim():'';
    if(importedRawValue.charAt(0)==='['){
      try{var importedValues=JSON.parse(importedRawValue);if(Array.isArray(importedValues)&&typeof importedValues[0]==='string')importedRawValue=importedValues[0]}catch(error){}
    }
    if(importedNameInput){
      var importedRow=importedNameInput.closest('.field');
      if(importedRow){
        importedRow.hidden=true;
        importedRow.querySelectorAll('input,textarea,select').forEach(function(input){input.disabled=true});
      }
    }
    if(!nameInput){
      nameInput=document.createElement('input');nameInput.type='hidden';nameInput.name='fieldNames[]';nameInput.value=fieldName;form.appendChild(nameInput);
    }
    if(!typeInput){
      typeInput=document.createElement('input');typeInput.type='hidden';typeInput.name='fieldTypes['+fieldName+']';typeInput.value='str';form.appendChild(typeInput);
    }else{typeInput.value='str'}
    if(!valueInput){
      valueInput=document.createElement('textarea');valueInput.name='fieldValues['+fieldName+']';valueInput.hidden=true;form.appendChild(valueInput);
    }
    var rawValue=valueInput.value.trim()||importedRawValue;
    var defaultItem={name:'local',key:'',url:'',resource_name:'',show_type:''};
    var state={open:true,content:'',download_list:[]};
    var valid=true;
    var contentDirty=false;
    function decode(value){
      var binary=atob(value.replace(/\s/g,''));
      var bytes=Uint8Array.from(binary,function(character){return character.charCodeAt(0)});
      return new TextDecoder().decode(bytes);
    }
    function encode(value){
      var bytes=new TextEncoder().encode(value),binary='';
      for(var i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
      return btoa(binary);
    }
    if(rawValue){
      try{
        var parsed=JSON.parse(decode(rawValue));
        if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('invalid meta');
        state=Object.assign({},state,parsed);
        state.open=parsed.open===undefined?true:parsed.open;
        state.content=typeof parsed.content==='string'?parsed.content:'';
        state.download_list=Array.isArray(parsed.download_list)
          ?parsed.download_list.map(function(item){return Object.assign({},defaultItem,item&&typeof item==='object'?item:{})})
          :[];
      }catch(error){valid=false}
    }
    var editor=document.getElementById('core_download_content');
    if(editor&&state.content){
      try{editor.innerHTML=decode(state.content)}catch(error){valid=false}
    }
    if(!valid){
      var warning=document.createElement('p');
      warning.className='core-download-data-warning';
      warning.textContent='原版字段无法解码。为避免覆盖迁移数据，当前已阻止文章保存；请检查 core_download_meta_box 原始值。';
      root.parentNode.insertBefore(warning,root);
    }
    window.core_download_mete_box=state;
    window.core_download_download_url_default=Object.assign({},defaultItem);

    if(editor){
      editor.addEventListener('input',function(){contentDirty=true});
      var toolbar=document.getElementById('core-download-content-toolbar');
      if(toolbar)toolbar.addEventListener('click',function(event){
        var button=event.target.closest('button[data-command]');if(!button)return;
        var command=button.dataset.command,value=null;
        if(command==='createLink'){value=window.prompt('请输入链接地址');if(!value)return}
        editor.focus();document.execCommand(command,false,value);contentDirty=true;
      });
      var color=document.getElementById('core-download-content-color');
      if(color)color.addEventListener('input',function(event){editor.focus();document.execCommand('foreColor',false,event.target.value);contentDirty=true});
      var fullscreen=document.getElementById('core-download-content-fullscreen');
      var editorWrap=document.getElementById('wp-core_download_content-wrap');
      var exitFullscreenButton=null;
      function setEditorFullscreen(active){
        if(!editorWrap||!fullscreen)return;
        editorWrap.classList.toggle('is-fullscreen',active);
        editor.classList.toggle('is-fullscreen',active);
        fullscreen.setAttribute('aria-pressed',active?'true':'false');
        fullscreen.textContent=active?'退出全屏':'全屏';
        if(active&&!exitFullscreenButton&&toolbar){
          exitFullscreenButton=document.createElement('button');
          exitFullscreenButton.type='button';
          exitFullscreenButton.className='core-download-content-exit';
          exitFullscreenButton.setAttribute('aria-label','退出全屏');
          exitFullscreenButton.setAttribute('title','退出全屏');
          exitFullscreenButton.textContent='×';
          exitFullscreenButton.addEventListener('click',function(event){
            event.preventDefault();
            event.stopPropagation();
            setEditorFullscreen(false);
          });
          toolbar.appendChild(exitFullscreenButton);
        }else if(!active&&exitFullscreenButton){
          exitFullscreenButton.remove();
          exitFullscreenButton=null;
        }
      }
      if(fullscreen)fullscreen.addEventListener('click',function(){
        setEditorFullscreen(!editorWrap.classList.contains('is-fullscreen'));
      });
      document.addEventListener('keydown',function(event){
        if(event.key==='Escape'&&editorWrap&&editorWrap.classList.contains('is-fullscreen')){
          event.preventDefault();
          setEditorFullscreen(false);
        }
      });
      document.addEventListener('click',function(event){
        if(!editorWrap||!editorWrap.classList.contains('is-fullscreen'))return;
        if(event.target===editorWrap||!editorWrap.contains(event.target))setEditorFullscreen(false);
      });
    }

    form.addEventListener('submit',function(event){
      if(!valid){event.preventDefault();window.alert('原版下载字段无法解析，已阻止保存以保护原始数据。');return}
      var output=state;
      var vueInput=root.querySelector('input[name="core_download_meta_box"]');
      if(vueInput&&vueInput.value){
        try{
          var vueState=JSON.parse(vueInput.value);
          if(vueState&&typeof vueState==='object'&&!Array.isArray(vueState))output=vueState;
        }catch(error){}
      }
      output=Object.assign({},output);
      if(contentDirty&&editor)output.content=encode(editor.innerHTML);
      valueInput.value=encode(JSON.stringify(output));
      typeInput.value='str';
    });
  }

  initSettings();
  initPostEditor();
})();
