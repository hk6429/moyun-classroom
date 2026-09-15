let importing=false,retryImport=null;
async function* materialPages(file,start,signal){
 if(/\.pptx?$/i.test(file.name))throw Error('PPT 請先在 PowerPoint 匯出 PDF，再上傳；直接匯入列為後續功能');
 if(/\.pdf$/i.test(file.name)){
 const pdfjs=await import('/vendor/pdfjs/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.mjs';
 const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',isEvalSupported:false});
 const abort=()=>task.destroy();signal.addEventListener('abort',abort,{once:true});
 let doc;try{doc=await task.promise;for(let i=start;i<doc.numPages;i++){if(signal.aborted)throw Error('已取消');const page=await doc.getPage(i+1),original=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2,1800/Math.max(original.width,original.height))}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'white'}).promise;const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.9));if(!blob)throw Error('無法產生頁面圖片');yield {file:new File([blob],file.name.replace(/\.pdf$/i,'')+' · 第 '+(i+1)+' 頁.jpg',{type:'image/jpeg'}),page:i,total:doc.numPages};canvas.width=canvas.height=0;page.cleanup();}}finally{signal.removeEventListener('abort',abort);await task.destroy();}
 }else{
 if(!/\.(png|jpe?g|gif|webp)$/i.test(file.name))throw Error('支援 PDF、PNG、JPG、GIF、WebP');
 if(file.size>8*1024*1024)throw Error('圖片超過 8 MB，請縮小解析度後再試');
 yield {file,page:0,total:1};
 }
}
async function importFiles(files){
 if(importing)return toast('另一份教材正在匯入');if(!files.length)return;
 const prior=retryImport,d=prior?.deck||decks[deckIndex],position=prior?.position??editIndex+1,offsets=prior?.offsets||new Map();retryImport=null;importing=true;
 const modal=document.querySelector('#modal');modal.innerHTML='<h2>正在匯入教材</h2><p id="import-progress" role="status">準備處理……</p><p class="muted">PDF 會在這台裝置轉頁，完成的頁面會保留。PPT 請先匯出 PDF。</p><button type="button" id="import-cancel">取消剩餘匯入</button><button type="button" id="import-hide">背景處理</button>';modal.showModal();
 document.querySelector('#import-hide').onclick=()=>modal.close();
 const controller=new AbortController();document.querySelector('#import-cancel').onclick=()=>controller.abort();
 const slides=[],failed=[],errors=[];
 try{
 for(const file of files){
 if(controller.signal.aborted){failed.push(file);continue;}
 try{
 for await(const item of materialPages(file,offsets.get(file)||0,controller.signal)){
 if(controller.signal.aborted)throw Error('已取消');
 const p=document.querySelector('#import-progress');if(p)p.textContent=file.name+'：第 '+(item.page+1)+'／'+item.total+' 頁';
 const response=await fetch('/api/upload?name='+encodeURIComponent(item.file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:item.file,signal:controller.signal});const job=await response.json();if(!response.ok)throw Error(job.error||'上傳失敗');
 const deadline=Date.now()+60000;
 for(;;){const res=await fetch('/api/import-status?id='+job.id,{signal:controller.signal});const j=await res.json();if(!res.ok||['error','cancelled'].includes(j.status))throw Error(j.message||j.error||'匯入失敗');if(j.status==='done'){slides.push(...j.slides);offsets.set(file,item.page+1);break;}if(Date.now()>deadline)throw Error('匯入逾時');await new Promise(r=>setTimeout(r,500));}
 }
 }catch(e){failed.push(file);errors.push(file.name+'：'+(controller.signal.aborted?'已取消':e.message));}
 }
 d.slides.splice(position,0,...slides);save();if(page==='edit'&&decks[deckIndex]===d){editIndex=Math.min(position,d.slides.length-1);editor();}
 if(failed.length){retryImport={files:failed,deck:d,position:position+slides.length,offsets};modal.innerHTML='<h2>已保留 '+slides.length+' 頁</h2><p>'+errors.map(esc).join('<br>')+'</p><button id="retry-files">重試未完成頁面</button><form method="dialog"><button>稍後處理</button></form>';if(!modal.open)modal.showModal();document.querySelector('#retry-files').onclick=()=>{const files=retryImport.files;modal.close();importFiles(files);};}
 else{if(modal.open)modal.close();toast('已匯入 '+slides.length+' 頁');}
 }finally{importing=false;}
}
